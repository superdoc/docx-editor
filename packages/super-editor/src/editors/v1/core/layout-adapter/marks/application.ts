/**
 * Mark Application Module
 *
 * Functions for applying ProseMirror marks to text runs, including:
 * - Text formatting (bold, italic, underline, strike, highlight)
 * - Text styles (color, font, size, letter spacing)
 * - Hyperlinks
 * - Tracked changes (insert, delete, format)
 */

import {
  normalizeBaselineShift,
  scaleFontSizeForVerticalText,
  type TextRun,
  type TabRun,
  type RunMark,
  type TrackedChangeMeta,
  type TrackedChangeKind,
} from '@superdoc/contracts';
import type { UnderlineStyle, PMMark, HyperlinkConfig, ThemeColorPalette } from '../types.js';
import { normalizeColor, isFiniteNumber, ptToPx } from '../utilities.js';
import { buildFlowRunLink, migrateLegacyLink } from './links.js';
import { sanitizeHref } from '@superdoc/url-validation';
import { resolveThemeColorValue } from './theme-color.js';

/**
 * Track change mark type constants from ProseMirror schema.
 */
export const TRACK_INSERT_MARK = 'trackInsert';
export const TRACK_DELETE_MARK = 'trackDelete';
export const TRACK_FORMAT_MARK = 'trackFormat';

/**
 * Map from PM mark type to tracked change kind.
 */
const TRACK_CHANGE_KIND_MAP: Record<string, TrackedChangeKind> = {
  [TRACK_INSERT_MARK]: 'insert',
  [TRACK_DELETE_MARK]: 'delete',
  [TRACK_FORMAT_MARK]: 'format',
};

/**
 * Priority levels for tracked change types when multiple marks overlap.
 * Higher priority wins (insert/delete take precedence over format).
 */
const TRACK_CHANGE_PRIORITY: Record<TrackedChangeKind, number> = {
  insert: 3,
  delete: 3,
  format: 1,
};

/**
 * Maximum allowed length for JSON-stringified run mark payloads.
 * Set to 10KB to balance flexibility with DoS protection.
 */
const MAX_RUN_MARK_JSON_LENGTH = 10_000;

/**
 * Maximum number of marks allowed in before/after arrays.
 * Prevents memory exhaustion from malicious payloads while supporting
 * reasonable formatting complexity.
 */
const MAX_RUN_MARK_ARRAY_LENGTH = 100;

/**
 * Maximum nesting depth for mark attribute objects.
 * Protects against stack overflow from deeply nested structures.
 */
const MAX_RUN_MARK_DEPTH = 5;
const RANDOM_ID_LENGTH = 9;

type CommentAnnotation = {
  commentId: string;
  importedId?: string;
  internal?: boolean;
  trackedChange?: boolean;
};

const generateRandomBase36Id = (length: number): string => {
  let randomId = '';
  while (randomId.length < length) {
    randomId += Math.random().toString(36).slice(2);
  }
  return randomId.slice(0, length);
};

/**
 * Validates JSON object depth to prevent deeply nested structures.
 * Recursively checks nesting level to prevent stack overflow attacks.
 *
 * @param obj - The object to validate
 * @param currentDepth - Current recursion depth (internal use)
 * @returns true if within depth limit, false otherwise
 */
const validateDepth = (obj: unknown, currentDepth = 0): boolean => {
  if (currentDepth > MAX_RUN_MARK_DEPTH) {
    return false;
  }
  if (obj && typeof obj === 'object') {
    const values = Array.isArray(obj) ? obj : Object.values(obj);
    for (const value of values) {
      if (!validateDepth(value, currentDepth + 1)) {
        return false;
      }
    }
  }
  return true;
};

const expandHex = (hex: string): string => {
  const normalized = hex.replace('#', '');
  if (normalized.length === 3) {
    return normalized
      .split('')
      .map((char) => char + char)
      .join('');
  }
  return normalized;
};

const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const cleaned = expandHex(hex);
  if (cleaned.length !== 6) return null;
  const r = Number.parseInt(cleaned.slice(0, 2), 16);
  const g = Number.parseInt(cleaned.slice(2, 4), 16);
  const b = Number.parseInt(cleaned.slice(4, 6), 16);
  if ([r, g, b].some((channel) => Number.isNaN(channel))) return null;
  return { r, g, b };
};

/**
 * Calculates relative luminance of a hex color per WCAG 2.1 guidelines.
 *
 * Implements the WCAG 2.1 relative luminance formula to determine perceived brightness
 * of a color. This is critical for ensuring sufficient contrast between text and background
 * colors to meet accessibility standards (WCAG AA requires 4.5:1 contrast for normal text).
 *
 * The calculation converts RGB values to linear RGB space using the sRGB gamma correction,
 * then applies weighted coefficients based on human perception (green contributes most to
 * perceived brightness, blue the least).
 *
 * @param hexColor - Hex color string (e.g., "#FF0000" or "F00" for red). May optionally
 *   include the "#" prefix. Supports both 3-digit (#RGB) and 6-digit (#RRGGBB) formats.
 * @returns Relative luminance value from 0 (black) to 1 (white). Returns 1.0 (light) for
 *   invalid color strings to default to black text for safety.
 *
 * @example
 * ```typescript
 * getLuminance('#FFFFFF'); // 1.0 (pure white)
 * getLuminance('#000000'); // 0.0 (pure black)
 * getLuminance('#808080'); // ~0.2159 (mid gray)
 * getLuminance('#342D8C'); // ~0.0557 (dark purple, < 0.18 threshold)
 * getLuminance('#F00');    // 0.2126 (red in short form)
 * getLuminance('invalid'); // 1.0 (defaults to light/black text)
 * ```
 *
 * @see https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 * @see https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */
export const getLuminance = (hexColor: string): number => {
  const rgb = hexToRgb(hexColor);
  if (!rgb) return 1; // Default to light if invalid color
  const toLinear = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const R = toLinear(rgb.r);
  const G = toLinear(rgb.g);
  const B = toLinear(rgb.b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
};

/**
 * WCAG AA luminance threshold for 4.5:1 contrast ratio.
 * Backgrounds darker than this threshold should use white text.
 */
const WCAG_AA_LUMINANCE_THRESHOLD = 0.18;

/**
 * Resolves auto text color (black or white) based on background luminance for optimal contrast.
 *
 * Automatically determines whether to use white (#FFFFFF) or black (#000000) text based on
 * the background color's relative luminance to ensure WCAG AA compliance (4.5:1 contrast ratio
 * for normal text). This is essential for table cells and other elements where text color is
 * not explicitly set.
 *
 * The function uses a luminance threshold of 0.18 - backgrounds darker than this receive white
 * text, while lighter backgrounds receive black text. This threshold is calibrated to ensure
 * maximum readability across all background colors.
 *
 * @param backgroundColor - Background color as hex string (e.g., "#FF0000", "F00", or "#808080").
 *   May optionally include the "#" prefix. Supports both 3-digit and 6-digit hex formats.
 * @returns "#FFFFFF" (white) for dark backgrounds (luminance < 0.18), or "#000000" (black)
 *   for light backgrounds (luminance >= 0.18).
 *
 * @example
 * ```typescript
 * resolveAutoColor('#000000'); // "#FFFFFF" (white text on black)
 * resolveAutoColor('#FFFFFF'); // "#000000" (black text on white)
 * resolveAutoColor('#342D8C'); // "#FFFFFF" (white text on dark purple)
 * resolveAutoColor('#CCCCCC'); // "#000000" (black text on light gray)
 * resolveAutoColor('#808080'); // "#000000" (black text on mid gray, at threshold boundary)
 * ```
 *
 * @see https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 * @see {@link getLuminance} for luminance calculation details
 */
export const resolveAutoColor = (backgroundColor: string): string => {
  const luminance = getLuminance(backgroundColor);
  return luminance < WCAG_AA_LUMINANCE_THRESHOLD ? '#FFFFFF' : '#000000';
};

const resolveThemeColor = (
  attrs: Record<string, unknown> | undefined,
  themeColors?: ThemeColorPalette,
): string | undefined => {
  if (!attrs || !themeColors) return undefined;
  const rawKey = attrs.themeColor;
  if (typeof rawKey !== 'string') return undefined;
  return resolveThemeColorValue(
    rawKey,
    attrs.themeTint as string | undefined,
    attrs.themeShade as string | undefined,
    themeColors,
  );
};

const resolveColorFromAttributes = (
  attrs: Record<string, unknown> | undefined,
  themeColors?: ThemeColorPalette,
): string | undefined => {
  if (!attrs) return undefined;
  if (typeof attrs.color === 'string') {
    const normalized = normalizeColor(attrs.color);
    if (normalized) {
      return normalized;
    }
  }
  const theme = resolveThemeColor(attrs, themeColors);
  if (theme) {
    return normalizeColor(theme);
  }
  return undefined;
};

/**
 * Maximum number of data-* attributes allowed per mark.
 * Prevents DoS attacks from malicious payloads with excessive attributes.
 */
const MAX_DATA_ATTR_COUNT = 50;

/**
 * Maximum length for data-* attribute values.
 * Prevents memory exhaustion from extremely long attribute values.
 */
const MAX_DATA_ATTR_VALUE_LENGTH = 1000;

/**
 * Maximum length for data-* attribute names.
 * Prevents memory exhaustion from extremely long attribute names.
 */
const MAX_DATA_ATTR_NAME_LENGTH = 100;

const pushCommentAnnotation = (run: TextRun, attrs: Record<string, unknown> | undefined): void => {
  const commentId = typeof attrs?.commentId === 'string' ? attrs.commentId : undefined;
  const importedId = typeof attrs?.importedId === 'string' ? attrs.importedId : undefined;
  const internal = attrs?.internal === true;
  const trackedChange = attrs?.trackedChange === true;

  if (!commentId && !importedId) return;

  const annotations: CommentAnnotation[] = run.comments ? [...run.comments] : [];
  const key = `${commentId ?? ''}::${importedId ?? ''}`;
  const exists = annotations.some((c) => `${c.commentId ?? ''}::${c.importedId ?? ''}` === key);
  if (!exists) {
    annotations.push({
      commentId: commentId ?? (importedId as string),
      importedId,
      internal,
      trackedChange,
    });
  }

  run.comments = annotations;
};

/**
 * Extracts data-* attributes from a mark's attrs and normalizes values to strings.
 * Only forwards primitive/stringifiable values to avoid bloating run payloads.
 * Applies security limits to prevent DoS attacks from malicious payloads.
 *
 * @param attrs - Mark attributes object that may contain data-* attributes
 * @returns Record of data-* attributes with string values, or undefined if no valid attributes found
 *
 * @example
 * ```typescript
 * extractDataAttributes({ 'data-id': '123', 'data-name': 'test' });
 * // Returns: { 'data-id': '123', 'data-name': 'test' }
 *
 * extractDataAttributes({ 'data-id': 123, 'data-active': true });
 * // Returns: { 'data-id': '123', 'data-active': 'true' }
 *
 * extractDataAttributes({ color: 'red', 'data-id': '123' });
 * // Returns: { 'data-id': '123' } (non-data attributes filtered out)
 * ```
 */
export const extractDataAttributes = (
  attrs: Record<string, unknown> | undefined,
): Record<string, string> | undefined => {
  if (!attrs) return undefined;
  const result: Record<string, string> = {};
  let attrCount = 0;

  for (const [key, value] of Object.entries(attrs)) {
    if (typeof key !== 'string' || !key.toLowerCase().startsWith('data-')) {
      continue;
    }

    // Enforce maximum number of data attributes
    if (attrCount >= MAX_DATA_ATTR_COUNT) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[PM-Adapter] Rejecting data attributes exceeding ${MAX_DATA_ATTR_COUNT} limit`);
      }
      break;
    }

    // Enforce maximum attribute name length
    if (key.length > MAX_DATA_ATTR_NAME_LENGTH) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(
          `[PM-Adapter] Rejecting data attribute name exceeding ${MAX_DATA_ATTR_NAME_LENGTH} chars: ${key.substring(0, 50)}...`,
        );
      }
      continue;
    }

    if (value == null) {
      continue;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const stringValue = String(value);

      // Enforce maximum value length
      if (stringValue.length > MAX_DATA_ATTR_VALUE_LENGTH) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(
            `[PM-Adapter] Rejecting data attribute value exceeding ${MAX_DATA_ATTR_VALUE_LENGTH} chars for key: ${key}`,
          );
        }
        continue;
      }

      result[key] = stringValue;
      attrCount++;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
};

/**
 * Normalizes and validates run mark lists from trackFormat metadata.
 * Applies security limits to prevent DoS attacks from malicious payloads.
 *
 * @param value - Raw mark list (string JSON or array)
 * @returns Normalized RunMark array, or undefined if validation fails
 */
export const normalizeRunMarkList = (value: unknown): RunMark[] | undefined => {
  if (!value) return undefined;
  let entries: unknown = value;
  if (typeof value === 'string') {
    // Prevent DoS attacks from extremely large JSON payloads
    if (value.length > MAX_RUN_MARK_JSON_LENGTH) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[PM-Adapter] Rejecting run mark JSON payload exceeding ${MAX_RUN_MARK_JSON_LENGTH} chars`);
      }
      return undefined;
    }
    try {
      entries = JSON.parse(value);
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[PM-Adapter] Failed to parse run mark JSON:', error);
      }
      return undefined;
    }
  }
  if (!Array.isArray(entries)) {
    return undefined;
  }
  if (entries.length > MAX_RUN_MARK_ARRAY_LENGTH) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[PM-Adapter] Rejecting run mark array exceeding ${MAX_RUN_MARK_ARRAY_LENGTH} entries`);
    }
    return undefined;
  }
  if (!validateDepth(entries)) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[PM-Adapter] Rejecting run mark array exceeding depth ${MAX_RUN_MARK_DEPTH}`);
    }
    return undefined;
  }
  const normalized = entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const record = entry as Record<string, unknown>;
      const type = typeof record.type === 'string' ? record.type : undefined;
      if (!type) return null;
      const attrs =
        record.attrs && typeof record.attrs === 'object' ? (record.attrs as Record<string, unknown>) : undefined;
      return { type, attrs } as RunMark;
    })
    .filter(Boolean) as RunMark[];
  return normalized.length ? normalized : undefined;
};

/**
 * Maps a ProseMirror mark type to a tracked change kind.
 *
 * @param markType - The PM mark type string (e.g., 'trackInsert', 'trackDelete', 'trackFormat')
 * @returns The corresponding TrackedChangeKind ('insert', 'delete', or 'format'), or undefined if not a tracked change mark
 */
export const pickTrackedChangeKind = (markType: string): TrackedChangeKind | undefined => {
  return TRACK_CHANGE_KIND_MAP[markType];
};

/**
 * Derives a unique tracked change ID from mark attributes.
 * Falls back to generating a unique ID from author/date/timestamp if not provided.
 *
 * @param kind - The tracked change kind (insert/delete/format)
 * @param attrs - Mark attributes containing id, author, and date
 * @returns A unique tracked change ID
 */
const deriveTrackedChangeId = (kind: TrackedChangeKind, attrs: Record<string, unknown> | undefined): string => {
  if (attrs && typeof attrs.id === 'string' && attrs.id.trim()) {
    return attrs.id;
  }
  const authorEmail = attrs && typeof attrs.authorEmail === 'string' ? attrs.authorEmail : 'unknown';
  const date = attrs && typeof attrs.date === 'string' ? attrs.date : 'unknown';
  // Add timestamp and random component to ensure uniqueness when author/date are missing
  const unique = `${Date.now()}-${generateRandomBase36Id(RANDOM_ID_LENGTH)}`;
  return `${kind}-${authorEmail}-${date}-${unique}`;
};

/**
 * Builds tracked change metadata from a ProseMirror mark.
 * Extracts author info, timestamps, and before/after formatting for trackFormat marks.
 *
 * @param mark - ProseMirror mark containing tracked change attributes
 * @returns TrackedChangeMeta object, or undefined if not a tracked change mark
 */
export const buildTrackedChangeMetaFromMark = (mark: PMMark, storyKey?: string): TrackedChangeMeta | undefined => {
  const kind = pickTrackedChangeKind(mark.type);
  if (!kind) return undefined;
  const attrs = mark.attrs ?? {};
  const meta: TrackedChangeMeta = {
    kind,
    id: deriveTrackedChangeId(kind, attrs),
  };
  if (typeof attrs.overlapParentId === 'string' && attrs.overlapParentId) {
    meta.overlapParentId = attrs.overlapParentId;
    meta.relationship = 'child';
  }
  if (typeof attrs.author === 'string' && attrs.author) {
    meta.author = attrs.author;
  }
  if (typeof attrs.authorEmail === 'string' && attrs.authorEmail) {
    meta.authorEmail = attrs.authorEmail;
  }
  if (typeof attrs.authorImage === 'string' && attrs.authorImage) {
    meta.authorImage = attrs.authorImage;
  }
  if (typeof attrs.date === 'string' && attrs.date) {
    meta.date = attrs.date;
  }
  if (kind === 'format') {
    meta.before = normalizeRunMarkList((attrs as { before?: unknown }).before);
    meta.after = normalizeRunMarkList((attrs as { after?: unknown }).after);
  }
  if (typeof storyKey === 'string' && storyKey.length > 0) {
    meta.storyKey = storyKey;
  }
  return meta;
};

/**
 * Selects the higher-priority tracked change metadata when multiple marks overlap.
 * Insert/delete marks (priority 3) take precedence over format marks (priority 1).
 *
 * @param existing - Current tracked change metadata, if any
 * @param next - New tracked change metadata to consider
 * @returns The higher-priority metadata
 */
export const selectTrackedChangeMeta = (
  existing: TrackedChangeMeta | undefined,
  next: TrackedChangeMeta,
): TrackedChangeMeta => {
  if (!existing) return next;
  const existingPriority = TRACK_CHANGE_PRIORITY[existing.kind] ?? 0;
  const nextPriority = TRACK_CHANGE_PRIORITY[next.kind] ?? 0;
  if (nextPriority > existingPriority) {
    return next;
  }
  return existing;
};

const trackedChangeLayerKey = (meta: TrackedChangeMeta): string => `${meta.kind}:${meta.id}`;

const trackedChangeLayerIdentity = (meta: TrackedChangeMeta): string =>
  [meta.kind, meta.id, meta.overlapParentId ?? ''].join(':');

const compareTrackedChangeLayerStrings = (a: string, b: string): number => {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
};

const trackedChangeContentRank = (meta: TrackedChangeMeta): number => (meta.kind === 'format' ? 1 : 0);

const trackedChangeRelationshipRank = (meta: TrackedChangeMeta): number => {
  if (meta.relationship === 'parent') return 0;
  if (meta.relationship === 'child') return 2;
  return 1;
};

const compareTrackedChangeLayers = (a: TrackedChangeMeta, b: TrackedChangeMeta): number => {
  const aIsParentOfB = a.id === b.overlapParentId;
  const bIsParentOfA = b.id === a.overlapParentId;
  if (aIsParentOfB && !bIsParentOfA) return -1;
  if (bIsParentOfA && !aIsParentOfB) return 1;

  const contentRank = trackedChangeContentRank(a) - trackedChangeContentRank(b);
  if (contentRank !== 0) return contentRank;

  const relationshipRank = trackedChangeRelationshipRank(a) - trackedChangeRelationshipRank(b);
  if (relationshipRank !== 0) return relationshipRank;

  const idOrder = compareTrackedChangeLayerStrings(a.id, b.id);
  if (idOrder !== 0) return idOrder;

  const kindOrder = compareTrackedChangeLayerStrings(a.kind, b.kind);
  if (kindOrder !== 0) return kindOrder;

  const parentOrder = compareTrackedChangeLayerStrings(a.overlapParentId ?? '', b.overlapParentId ?? '');
  if (parentOrder !== 0) return parentOrder;

  return compareTrackedChangeLayerStrings(a.storyKey ?? '', b.storyKey ?? '');
};

const normalizeTrackedChangeLayerList = (layers: TrackedChangeMeta[]): TrackedChangeMeta[] => {
  if (layers.length === 0) return [];

  const uniqueLayers = new Map<string, TrackedChangeMeta>();
  layers.forEach((layer) => {
    const key = trackedChangeLayerKey(layer);
    if (!uniqueLayers.has(key)) {
      uniqueLayers.set(key, { ...layer });
    }
  });

  const parentIds = new Set<string>();
  uniqueLayers.forEach((layer) => {
    if (layer.overlapParentId) {
      parentIds.add(layer.overlapParentId);
    }
  });

  return Array.from(uniqueLayers.values())
    .map((layer) => {
      const normalized = { ...layer };
      if (normalized.overlapParentId) {
        normalized.relationship = 'child';
      } else if (parentIds.has(normalized.id)) {
        normalized.relationship = 'parent';
      } else {
        delete normalized.relationship;
      }
      return normalized;
    })
    .sort(compareTrackedChangeLayers);
};

const normalizeTrackedChangeLayers = (run: TextRun | TabRun): TrackedChangeMeta[] => {
  if (Array.isArray(run.trackedChanges) && run.trackedChanges.length > 0) {
    return normalizeTrackedChangeLayerList(run.trackedChanges);
  }
  return run.trackedChange ? normalizeTrackedChangeLayerList([run.trackedChange]) : [];
};

const appendTrackedChangeLayer = (run: TextRun | TabRun, meta: TrackedChangeMeta): void => {
  const layers = normalizeTrackedChangeLayers(run);
  const key = trackedChangeLayerKey(meta);
  if (!layers.some((layer) => trackedChangeLayerKey(layer) === key)) {
    layers.push(meta);
  }
  const normalizedLayers = normalizeTrackedChangeLayerList(layers);
  run.trackedChanges = normalizedLayers;
  run.trackedChange = normalizedLayers[0];
};

/**
 * Checks if two text runs have compatible tracked change metadata for merging.
 * Runs are compatible if their normalized tracked-change layer identities match,
 * or both have no metadata.
 *
 * @param a - First text run
 * @param b - Second text run
 * @returns true if runs can be merged, false otherwise
 */
export const trackedChangesCompatible = (a: TextRun, b: TextRun): boolean => {
  const aLayers = normalizeTrackedChangeLayers(a);
  const bLayers = normalizeTrackedChangeLayers(b);
  if (aLayers.length !== bLayers.length) return false;
  return aLayers.every((aMeta, index) => {
    const bMeta = bLayers[index];
    return Boolean(bMeta && trackedChangeLayerIdentity(aMeta) === trackedChangeLayerIdentity(bMeta));
  });
};

export const collectTrackedChangesFromMarks = (marks?: PMMark[], storyKey?: string): TrackedChangeMeta[] => {
  if (!marks || !marks.length) return [];
  const seen = new Set<string>();
  const trackedChanges: TrackedChangeMeta[] = [];
  marks.forEach((mark) => {
    const meta = buildTrackedChangeMetaFromMark(mark, storyKey);
    if (!meta) return;
    const key = trackedChangeLayerKey(meta);
    if (seen.has(key)) return;
    seen.add(key);
    trackedChanges.push(meta);
  });
  return normalizeTrackedChangeLayerList(trackedChanges);
};

/**
 * Collects and prioritizes tracked change metadata from an array of ProseMirror marks.
 * When multiple tracked change marks are present, returns the first normalized layer.
 *
 * @param marks - Array of ProseMirror marks to process
 * @returns The primary TrackedChangeMeta, or undefined if none found
 */
export const collectTrackedChangeFromMarks = (marks?: PMMark[], storyKey?: string): TrackedChangeMeta | undefined => {
  return collectTrackedChangesFromMarks(marks, storyKey)[0];
};

/**
 * Normalizes underline style value from PM mark attributes.
 * Returns a valid UnderlineStyle, or undefined for explicit off values.
 * Missing/undefined values default to 'single' (presence of underline mark implies underline).
 *
 * @param value - Unknown value from mark attributes that should be an underline style
 * @returns A valid UnderlineStyle ('single', 'double', 'dotted', 'dashed', 'wavy'), or undefined if explicitly disabled
 *
 * @remarks
 * Handles multiple value types:
 * - Strings: Recognizes specific underline styles ('double', 'dotted', etc.) and off values ('none', '0', 'false', 'off')
 * - Numbers: 0 returns undefined (off), any other number returns 'single'
 * - Booleans: false returns undefined (off), true returns 'single'
 * - undefined/null: Returns 'single' (default)
 * - Empty/whitespace strings: Returns 'single' (default)
 *
 * @example
 * ```typescript
 * normalizeUnderlineStyle('double');    // 'double'
 * normalizeUnderlineStyle('none');      // undefined
 * normalizeUnderlineStyle(false);       // undefined
 * normalizeUnderlineStyle(0);           // undefined
 * normalizeUnderlineStyle(undefined);   // 'single'
 * normalizeUnderlineStyle(123);         // 'single'
 * normalizeUnderlineStyle('custom');    // 'single'
 * ```
 */
export const normalizeUnderlineStyle = (value: unknown): UnderlineStyle | undefined => {
  if (value === 'none') {
    return undefined;
  }
  if (value === undefined || value === null) {
    return 'single';
  }
  if (typeof value === 'boolean') {
    return value ? 'single' : undefined;
  }
  if (typeof value === 'number') {
    // Treat 0 as explicitly "off", any other number as "on" with default 'single' style
    return value === 0 ? undefined : 'single';
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    // Empty string defaults to 'single' because the presence of an underline mark
    // itself implies underline should be applied, even if the value is missing/empty
    if (!normalized) {
      return 'single';
    }
    if (normalized === 'none' || normalized === '0' || normalized === 'false' || normalized === 'off') {
      return undefined;
    }
    if (normalized === 'double' || normalized === 'dotted' || normalized === 'dashed' || normalized === 'wavy') {
      return normalized;
    }
    return 'single';
  }
  // Default to 'single' for missing values or other underline types (e.g., 'single', 'words', 'thick', etc.)
  // The presence of an underline mark implies underline should be applied
  return 'single';
};

/**
 * Normalizes ST_OnOff style mark values used for bold/italic/strike.
 * Returns true for any truthy/explicit-on values, false for explicit off,
 * and undefined when no value is provided (caller decides default).
 *
 * @param value - Raw mark attribute value (boolean/string/number)
 * @returns True, false, or undefined if value is not specified
 */
const normalizeBooleanMarkValue = (value: unknown): boolean | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'none') {
      return false;
    }
    if (normalized === '1' || normalized === 'true' || normalized === 'on') {
      return true;
    }
  }
  return Boolean(value);
};

/**
 * Maximum allowed length for font family names to prevent DoS attacks.
 * 200 characters is generous enough for legitimate font names while
 * preventing memory exhaustion from malicious payloads.
 */
const MAX_FONT_FAMILY_LENGTH = 200;

/**
 * Sanitizes font family names to prevent CSS injection and XSS attacks.
 * Applies multiple security filters to ensure only safe font names are used.
 *
 * Security measures:
 * - Rejects dangerous URI schemes (javascript:, data:, vbscript:)
 * - Removes CSS injection characters (semicolons, braces, @-rules, parentheses)
 * - Removes newlines and control characters
 * - Enforces reasonable length limits
 * - Strips quotes (CSS serialization will add them back safely)
 * - Removes angle brackets to prevent HTML injection
 *
 * @param fontFamily - Raw font family string from user input or document
 * @returns Sanitized font family name, or undefined if validation fails
 *
 * @example
 * ```typescript
 * sanitizeFontFamily('Arial');              // 'Arial'
 * sanitizeFontFamily('"Times New Roman"'); // 'Times New Roman'
 * sanitizeFontFamily('Arial; color: red'); // undefined (injection attempt)
 * sanitizeFontFamily('javascript:alert(1)'); // undefined (XSS attempt)
 * ```
 */
const sanitizeFontFamily = (fontFamily: string): string | undefined => {
  if (!fontFamily || typeof fontFamily !== 'string') {
    return undefined;
  }

  // Trim whitespace
  let sanitized = fontFamily.trim();

  // Enforce maximum length to prevent DoS
  if (sanitized.length > MAX_FONT_FAMILY_LENGTH) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[PM-Adapter] Font family name exceeds ${MAX_FONT_FAMILY_LENGTH} character limit`);
    }
    return undefined;
  }

  // Reject dangerous URI schemes (case-insensitive)
  const lowerCased = sanitized.toLowerCase();
  const dangerousSchemes = ['javascript:', 'data:', 'vbscript:'];
  if (dangerousSchemes.some((scheme) => lowerCased.includes(scheme))) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[PM-Adapter] Rejected font family containing dangerous URI scheme');
    }
    return undefined;
  }

  // Remove quotes - CSS serialization will handle quoting safely
  sanitized = sanitized.replace(/["']/g, '');

  // Reject CSS injection characters
  // Semicolons, braces, parentheses, and @ symbols can be used for CSS injection
  const cssInjectionPattern = /[;{}()@<>]/;
  if (cssInjectionPattern.test(sanitized)) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[PM-Adapter] Rejected font family containing CSS injection characters');
    }
    return undefined;
  }

  // Remove newlines and other control characters
  sanitized = sanitized.replace(/[\r\n\t\f\v]/g, ' ');

  // Collapse multiple spaces
  sanitized = sanitized.replace(/\s+/g, ' ').trim();

  // After sanitization, ensure we still have a valid non-empty string
  if (!sanitized) {
    return undefined;
  }

  return sanitized;
};

/**
 * Converts a CSS-like length value to pixels.
 *
 * - Numbers are treated as pixel values
 * - Strings ending with "pt" are converted to px (96 DPI)
 * - Strings ending with "px" or without a unit are treated as px
 * - Unknown units fall back to the numeric value (px) for backward compatibility
 */
const normalizeLengthPx = (value: unknown): number | undefined => {
  if (isFiniteNumber(value)) return value;
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const numeric = Number.parseFloat(trimmed);
  if (!Number.isFinite(numeric)) return undefined;

  const unit = trimmed.match(/[a-zA-Z%]+$/)?.[0]?.toLowerCase();
  if (unit === 'pt') {
    return ptToPx(numeric);
  }

  // Default: treat px, unitless, and unknown units as pixel values
  return numeric;
};

/**
 * Applies text style mark attributes to a text run.
 * Handles color, fontFamily, fontSize, and letterSpacing with validation and normalization.
 * Properties are applied with bounds checking and sanitization to prevent invalid values.
 *
 * @param run - The text run to apply styles to (mutated in place)
 * @param attrs - Mark attributes containing style properties:
 *   - color: Hex color string (e.g., "FF0000" or "#FF0000")
 *   - fontFamily: Font name string (sanitized for CSS injection)
 *   - fontSize: Numeric pixel value or string with units (e.g., 12, "12pt", "24px").
 *     Point values are converted to pixels (96 DPI); unitless/px values are treated as pixels.
 *     Valid range after conversion: 1-1000px. Values outside this range are ignored.
 *   - letterSpacing: Numeric pixel value or string with units (e.g., 2, "0.75pt", "-1px").
 *     Point values are converted to pixels (96 DPI); unitless/px values are treated as pixels.
 *     Valid range after conversion: -100 to 100px. Values outside this range are ignored.
 * @param themeColors - Optional theme color palette for color resolution
 */
export const applyTextStyleMark = (
  run: TextRun,
  attrs: Record<string, unknown>,
  themeColors?: ThemeColorPalette,
): void => {
  const resolvedColor = resolveColorFromAttributes(attrs, themeColors);
  if (resolvedColor) {
    run.color = resolvedColor;
  }
  if (typeof attrs.fontFamily === 'string' && attrs.fontFamily.trim()) {
    const sanitized = sanitizeFontFamily(attrs.fontFamily);
    if (sanitized) {
      run.fontFamily = sanitized;
    }
  }
  const fontSizePx = normalizeLengthPx(attrs.fontSize);
  if (fontSizePx !== undefined && fontSizePx >= 1 && fontSizePx <= 1000) {
    run.fontSize = fontSizePx;
  } else if (attrs.fontSize !== undefined) {
    // invalid or out-of-range size ignored
  }
  const letterSpacingPx = normalizeLengthPx(attrs.letterSpacing);
  if (letterSpacingPx !== undefined) {
    // Apply reasonable bounds (-100 to 100px) to prevent extreme values
    if (letterSpacingPx >= -100 && letterSpacingPx <= 100) {
      run.letterSpacing = letterSpacingPx;
    }
  }
  if (typeof attrs.textTransform === 'string') {
    const transform = attrs.textTransform as string;
    if (transform === 'uppercase' || transform === 'lowercase' || transform === 'capitalize' || transform === 'none') {
      run.textTransform = transform;
    }
  }
  // Vertical alignment (superscript/subscript)
  if (typeof attrs.vertAlign === 'string') {
    const va = attrs.vertAlign;
    if (va === 'superscript' || va === 'subscript' || va === 'baseline') {
      run.vertAlign = va;
    }
  }
  // Custom baseline shift (position) is explicit only when non-zero.
  // A zero position is an identity value and should behave like "no shift".
  if (attrs.position != null && typeof attrs.position === 'string') {
    const parsed = parseFloat(attrs.position);
    if (Number.isFinite(parsed)) {
      const normalizedBaselineShift = normalizeBaselineShift(parsed);
      if (normalizedBaselineShift == null) {
        delete run.baselineShift;
      } else {
        run.baselineShift = normalizedBaselineShift;
      }
    }
  }

  run.fontSize = scaleFontSizeForVerticalText(run.fontSize, run);
};

/**
 * Default hyperlink configuration.
 */
const DEFAULT_HYPERLINK_CONFIG: HyperlinkConfig = {
  enableRichHyperlinks: false,
};

/**
 * Applies all ProseMirror marks to a text run.
 * Processes formatting marks (bold, italic, underline, etc.),
 * text style marks, hyperlinks, and tracked changes in a single pass.
 * If an individual mark application fails, that mark is skipped and processing continues.
 *
 * @param run - The text run to apply marks to (mutated in place)
 * @param marks - Array of ProseMirror marks to apply
 * @param hyperlinkConfig - Configuration for hyperlink processing (defaults to basic mode)
 * @param themeColors - Optional theme color palette for resolving theme colors
 * @param backgroundColor - Optional cell background color for auto text color resolution
 * @param enableComments - Whether to process comment marks (defaults to true)
 * @throws Does not throw; errors in mark processing are logged but do not interrupt processing
 */
export const applyMarksToRun = (
  run: TextRun | TabRun,
  marks: PMMark[],
  hyperlinkConfig: HyperlinkConfig = DEFAULT_HYPERLINK_CONFIG,
  themeColors?: ThemeColorPalette,
  backgroundColor?: string,
  enableComments = true,
  storyKey?: string,
): void => {
  // If comments are disabled, clear any existing annotations before processing marks.
  if (!enableComments && 'comments' in run && (run as TextRun).comments) {
    delete (run as TextRun).comments;
  }

  // Type guard to distinguish TabRun from TextRun
  const isTabRun = run.kind === 'tab';

  // Track if any mark explicitly sets a color (vs style defaults)
  let markSetColor = false;

  marks.forEach((mark) => {
    const forwardedDataAttrs = extractDataAttributes(mark.attrs as Record<string, unknown> | undefined);
    try {
      switch (mark.type) {
        case TRACK_INSERT_MARK:
        case TRACK_DELETE_MARK:
        case TRACK_FORMAT_MARK: {
          // Tracked-change marks apply to TabRun too (SD-3376).
          const tracked = buildTrackedChangeMetaFromMark(mark, storyKey);
          if (tracked) {
            appendTrackedChangeLayer(run, tracked);
          }
          break;
        }
        case 'bold': {
          const normalized = normalizeBooleanMarkValue(mark.attrs?.value);
          if (normalized === false) {
            delete run.bold;
          } else {
            run.bold = true;
          }
          break;
        }
        case 'italic': {
          const normalized = normalizeBooleanMarkValue(mark.attrs?.value);
          if (normalized === false) {
            delete run.italic;
          } else {
            run.italic = true;
          }
          break;
        }
        case 'textStyle':
          // TextStyle mark only applies to TextRun (has fontFamily, fontSize, etc.)
          if (!isTabRun) {
            const colorBefore = run.color;
            applyTextStyleMark(run, mark.attrs ?? {}, themeColors);
            // Track if this mark explicitly set a color (not just inherited from style defaults)
            if (run.color !== colorBefore && run.color !== undefined) {
              markSetColor = true;
            }
          }
          break;
        case 'commentMark':
        case 'comment': {
          // Comment marks only apply to TextRun, and only when comments are enabled
          if (!isTabRun && enableComments) {
            pushCommentAnnotation(run, mark.attrs ?? {});
          }
          break;
        }
        case 'underline': {
          // Check multiple attribute names for underline value:
          // - underlineType: Primary attribute name (current schema)
          // - value: Legacy attribute name from older schemas
          // - underline: Alternative attribute name for consistency with other marks
          // - style: Fallback for Word import compatibility
          const underlineValue =
            mark.attrs?.underlineType ?? mark.attrs?.value ?? mark.attrs?.underline ?? mark.attrs?.style;
          const style = normalizeUnderlineStyle(underlineValue);
          if (style) {
            const underlineColor = resolveColorFromAttributes(mark.attrs ?? {}, themeColors);
            run.underline = {
              style,
              color: underlineColor ?? run.underline?.color,
            };
          } else if (underlineValue !== undefined && underlineValue !== null) {
            delete run.underline;
          }
          break;
        }
        case 'strike': {
          const normalized = normalizeBooleanMarkValue(mark.attrs?.value);
          if (normalized === false) {
            delete run.strike;
          } else {
            run.strike = true;
          }
          break;
        }
        case 'highlight':
          run.highlight = resolveColorFromAttributes(mark.attrs ?? {}, themeColors);
          break;
        case 'link': {
          // Link mark only applies to TextRun
          if (!isTabRun) {
            const attrs = (mark.attrs ?? {}) as Record<string, unknown>;
            if (hyperlinkConfig.enableRichHyperlinks) {
              try {
                const link = buildFlowRunLink(attrs);
                if (link) {
                  run.link = link as unknown as TextRun['link'];
                }
              } catch (error) {
                if (process.env.NODE_ENV === 'development') {
                  console.warn('[PM-Adapter] Failed to build rich hyperlink:', error);
                }
                // Fall through to legacy link handling or skip
              }
            } else if (typeof attrs.href === 'string' && attrs.href.trim()) {
              try {
                const sanitized = sanitizeHref(attrs.href);
                if (sanitized && sanitized.href) {
                  const legacyLink = {
                    href: sanitized.href,
                    title: typeof attrs.title === 'string' ? attrs.title : undefined,
                  };
                  run.link = migrateLegacyLink(legacyLink) as unknown as TextRun['link'];
                }
              } catch (error) {
                if (process.env.NODE_ENV === 'development') {
                  console.warn('[PM-Adapter] Failed to sanitize link href:', error);
                }
                // Skip this link if sanitization fails
              }
            }
          }
          break;
        }
        default:
          break;
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[PM-Adapter] Failed to apply mark ${mark.type}:`, error);
      }
      // Continue processing other marks
    }

    // dataAttrs only applies to TextRun
    if (forwardedDataAttrs && !isTabRun) {
      run.dataAttrs = { ...(run.dataAttrs ?? {}), ...forwardedDataAttrs };
    }
  });

  // Auto color resolution: if no mark explicitly set a color and we have a background color,
  // resolve text color based on background luminance for proper contrast (WCAG AA).
  // Respect colors that were already applied by styles/defaults; only fill when color is unset/auto.
  if (!isTabRun && !markSetColor && backgroundColor) {
    const normalizedExisting = normalizeColor(run.color);
    const normalizedUpper = normalizedExisting?.toUpperCase();
    const isDefaultBlack = normalizedUpper === '#000000' || normalizedUpper === '#000';
    const isAutoColorValue =
      typeof run.color === 'string' && ['auto', 'none'].includes(run.color.trim().replace(/^#/, '').toLowerCase());

    if (!normalizedExisting || isAutoColorValue || isDefaultBlack) {
      run.color = resolveAutoColor(backgroundColor);
    }
  }
};
