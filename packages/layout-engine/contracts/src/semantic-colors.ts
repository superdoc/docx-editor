/**
 * Semantic tracked-change color resolution (SD-3481 / SD-3479).
 *
 * This is the second tracked-change color axis. Where `author-colors.ts`
 * resolves one color per author *identity*, this module resolves a paint color
 * per tracked-change *visual role*: inserted text, deleted text, moved-from/-to
 * text, table/row/cell insertion/deletion, cell merge, and cell/table split. The same
 * author can therefore receive different colors for different review roles,
 * which the author-identity path cannot express.
 *
 * Hosts configure these through `trackChanges.semanticColors`.
 * SuperDoc composes those knobs into a single resolver and threads it into the
 * data-preparation pass so every tracked-change layer carries a paint-ready
 * `semanticColor`; DomPainter then only reads paint-ready metadata. Like the
 * author path, this lives in
 * `@superdoc/contracts` so adapters and the superdoc package can share the
 * resolver/types without leaking a private workspace specifier.
 *
 * This module is intentionally additive: it never reads or writes the existing
 * per-author `color` field. `color` remains the paint-ready per-author color.
 */

import { authorFromTrackedChangeMeta } from './author-colors.js';
import type { FlowBlock, TextRun, TrackChangeAuthor, TrackedChangeMeta } from './index.js';

/**
 * Tracked-change visual categories. This is the full paint/metadata
 * vocabulary: it names the DOM class, `data-track-change-semantic-color-key`
 * dataset value, and review-metadata category of every rendered
 * tracked-change side.
 *
 * COLOR ownership is split in two:
 * - {@link TrackedChangeConfigurableSemanticColorKey} (a subset) resolves its
 *   paint color through the JS `semanticColors` config (overrides/resolver)
 *   with the defaults below.
 * - The table-structure categories (`table-insertion`, `table-deletion`,
 *   `table-row-insertion`, `table-row-deletion`, `table-split`) are CSS-only:
 *   they carry NO JS-resolved color; DomPainter styles them via the
 *   `--sd-tracked-changes-table-*` theme variables, which hosts override in
 *   CSS.
 *
 * `move` is a group override key for both move sides; rendered move layers
 * continue to carry the specific `move-from` / `move-to` keys.
 * `table-split` covers whole-table split structure; `cell-split` covers split
 * cells.
 */
export type TrackedChangeSemanticColorKey =
  | 'insertion'
  | 'deletion'
  | 'move'
  | 'move-from'
  | 'move-to'
  | 'table-insertion'
  | 'table-deletion'
  | 'table-row-insertion'
  | 'table-row-deletion'
  | 'table-cell-insertion'
  | 'table-cell-deletion'
  | 'table-split'
  | 'cell-merge'
  | 'cell-split'
  | 'image-insertion'
  | 'image-deletion'
  | 'image-property-change';

/**
 * The categories whose paint color is resolvable through the JS
 * `semanticColors` config. Table-structure categories are deliberately
 * excluded: their colors are themed via CSS variables only.
 */
export type TrackedChangeConfigurableSemanticColorKey =
  | 'insertion'
  | 'deletion'
  | 'move'
  | 'move-from'
  | 'move-to'
  | 'table-cell-insertion'
  | 'table-cell-deletion'
  | 'cell-merge'
  | 'cell-split'
  | 'image-insertion'
  | 'image-deletion'
  | 'image-property-change';

/** All semantic color keys, in declaration order (useful for iteration/tests). */
export const TRACKED_CHANGE_SEMANTIC_COLOR_KEYS: readonly TrackedChangeSemanticColorKey[] = [
  'insertion',
  'deletion',
  'move',
  'move-from',
  'move-to',
  'table-insertion',
  'table-deletion',
  'table-row-insertion',
  'table-row-deletion',
  'table-cell-insertion',
  'table-cell-deletion',
  'table-split',
  'cell-merge',
  'cell-split',
  'image-insertion',
  'image-deletion',
  'image-property-change',
];

/** The JS-configurable subset, in declaration order. */
export const TRACKED_CHANGE_CONFIGURABLE_SEMANTIC_COLOR_KEYS: readonly TrackedChangeConfigurableSemanticColorKey[] = [
  'insertion',
  'deletion',
  'move',
  'move-from',
  'move-to',
  'table-cell-insertion',
  'table-cell-deletion',
  'cell-merge',
  'cell-split',
  'image-insertion',
  'image-deletion',
  'image-property-change',
];

const CONFIGURABLE_SEMANTIC_COLOR_KEY_SET: ReadonlySet<TrackedChangeSemanticColorKey> = new Set(
  TRACKED_CHANGE_CONFIGURABLE_SEMANTIC_COLOR_KEYS,
);

/** Whether a category resolves its color through the JS `semanticColors` config. */
export const isConfigurableSemanticColorKey = (
  key: TrackedChangeSemanticColorKey | null | undefined,
): key is TrackedChangeConfigurableSemanticColorKey => key != null && CONFIGURABLE_SEMANTIC_COLOR_KEY_SET.has(key);

/**
 * Default semantic colors per JS-configurable key. These are Word-like
 * defaults for SD-3479: insertion blue, deletion red, and moved text green.
 * All entries are hex constants so downstream focused-background derivation
 * (`colorWithAlpha`) works without extra parsing. Table-structure categories
 * have no entry here — their defaults live in the painter's CSS variables.
 */
export const DEFAULT_TRACKED_CHANGE_SEMANTIC_COLORS: Readonly<
  Record<TrackedChangeConfigurableSemanticColorKey, string>
> = {
  insertion: '#1f6feb',
  deletion: '#cb0e47',
  move: '#00853d',
  'move-from': '#00853d',
  'move-to': '#00853d',
  'table-cell-insertion': '#1f6feb',
  'table-cell-deletion': '#cb0e47',
  'cell-merge': '#d4a72c',
  'cell-split': '#f4964f',
  'image-insertion': '#1f6feb',
  'image-deletion': '#cb0e47',
  'image-property-change': '#d4a72c',
};

/** Input the host semantic resolver receives for a single tracked-change layer. */
export interface TrackedChangeSemanticColorResolverInput {
  /** Semantic category being colored (JS-configurable categories only). */
  key: TrackedChangeConfigurableSemanticColorKey;
  /** Author identity, when known (semantic colors are not author-derived). */
  author?: TrackChangeAuthor;
  /** Raw structural change type, when known. */
  type?: string;
  /** Logical structural subtype, when known. */
  subtype?: string;
  /** Structural target kind (e.g. cell/row/table), when known. */
  targetKind?: string;
  /** Scope of the semantic paint anchor, when known. */
  semanticAnchorScope?: string;
}

/**
 * A composed resolver mapping a semantic tracked-change input to a color.
 * Returns `undefined` only when the resolver itself declines for a key. The
 * composer returns `undefined` only when semantic colors are explicitly
 * disabled.
 */
export type TrackChangeSemanticColorResolver = (input: TrackedChangeSemanticColorResolverInput) => string | undefined;

/**
 * Host-facing semantic tracked-change color configuration. Mirrors the
 * `trackChanges.semanticColors` shape on the public `superdoc` package.
 */
export interface SemanticColorsConfig {
  /** When `false`, semantic colors are not applied. Defaults to enabled. */
  enabled?: boolean;
  /**
   * Color overrides keyed by semantic category. `move` applies to both move
   * sides unless a side-specific override exists. Table-structure categories
   * are not configurable here — theme them via the
   * `--sd-tracked-changes-table-*` CSS variables instead.
   */
  overrides?: Partial<Record<TrackedChangeConfigurableSemanticColorKey, string>>;
  /**
   * Resolver consulted after `overrides`. Return a CSS color string, or
   * `undefined`/nullish to fall through to the default semantic color.
   */
  resolve?: (input: TrackedChangeSemanticColorResolverInput) => string | undefined | null;
}

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

const stableSerializeSignatureValue = (value: unknown): string => {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerializeSignatureValue(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerializeSignatureValue(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(String(value));
};

/**
 * Deterministic signature for tracked-change metadata that can affect paint.
 *
 * Used by layout/painter cache keys. Keep this aligned with fields DomPainter
 * reads when stamping classes, datasets, CSS variables, and mode-dependent
 * tracked-change decorations.
 */
export const trackedChangeMetaSignature = (trackedChange: TrackedChangeMeta | null | undefined): string => {
  if (!trackedChange) return '';
  return stableSerializeSignatureValue([
    trackedChange.kind ?? '',
    trackedChange.id ?? '',
    trackedChange.storyKey ?? '',
    trackedChange.overlapParentId ?? '',
    trackedChange.relationship ?? '',
    trackedChange.author ?? '',
    trackedChange.authorEmail ?? '',
    trackedChange.authorImage ?? '',
    trackedChange.color ?? '',
    trackedChange.semanticColorKey ?? '',
    trackedChange.semanticColor ?? '',
    trackedChange.type ?? '',
    trackedChange.subtype ?? '',
    trackedChange.targetKind ?? '',
    trackedChange.semanticAnchorScope ?? '',
    trackedChange.date ?? '',
    trackedChange.before,
    trackedChange.after,
  ]);
};

export const trackedChangeLayersSignature = (
  trackedChanges: readonly TrackedChangeMeta[] | null | undefined,
): string => {
  if (!trackedChanges || trackedChanges.length === 0) return '';
  return trackedChanges.map((trackedChange) => trackedChangeMetaSignature(trackedChange)).join('|');
};

/** Default semantic color for a JS-configurable key, or `undefined` for an unknown/CSS-only key. */
export const defaultSemanticColor = (key: TrackedChangeSemanticColorKey): string | undefined =>
  isConfigurableSemanticColorKey(key) ? DEFAULT_TRACKED_CHANGE_SEMANTIC_COLORS[key] : undefined;

/** Structural target kind painted by a semantic color key. */
export type TrackedChangeSemanticTargetKind = 'text' | 'table' | 'row' | 'cell' | 'image';

/**
 * Target kind painted by each semantic color key. Single source of truth for
 * the projection (v2 host), the layout adapter, and sidebar metadata, so a key
 * added in one layer cannot silently disagree about its target in another.
 */
export const TRACKED_CHANGE_SEMANTIC_TARGET_KINDS: Readonly<
  Record<TrackedChangeSemanticColorKey, TrackedChangeSemanticTargetKind>
> = {
  insertion: 'text',
  deletion: 'text',
  move: 'text',
  'move-from': 'text',
  'move-to': 'text',
  'table-insertion': 'table',
  'table-deletion': 'table',
  'table-row-insertion': 'row',
  'table-row-deletion': 'row',
  'table-cell-insertion': 'cell',
  'table-cell-deletion': 'cell',
  'table-split': 'table',
  'cell-merge': 'cell',
  'cell-split': 'cell',
  'image-insertion': 'image',
  'image-deletion': 'image',
  'image-property-change': 'image',
};

/** Target kind for a semantic key, or `undefined` for an unknown/absent key. */
export const semanticColorTargetKind = (
  key: TrackedChangeSemanticColorKey | null | undefined,
): TrackedChangeSemanticTargetKind | undefined => (key == null ? undefined : TRACKED_CHANGE_SEMANTIC_TARGET_KINDS[key]);

/**
 * Keys whose paint anchors to an affected range rather than a single direct
 * marker (cell merge/split and table split are range paints).
 */
export const TRACKED_CHANGE_AFFECTED_RANGE_KEYS: ReadonlySet<TrackedChangeSemanticColorKey> = new Set([
  'cell-merge',
  'cell-split',
  'table-split',
]);

/** Anchor scope for a semantic key: `'affected-range'` for range paints, else `null`. */
export const semanticColorAnchorScope = (
  key: TrackedChangeSemanticColorKey | null | undefined,
): 'affected-range' | null => (key != null && TRACKED_CHANGE_AFFECTED_RANGE_KEYS.has(key) ? 'affected-range' : null);

const STRUCTURAL_SEMANTIC_KEY_BY_TARGET: Readonly<
  Record<'table' | 'row' | 'cell' | 'image', Readonly<Record<'insert' | 'delete', TrackedChangeSemanticColorKey>>>
> = {
  table: { insert: 'table-insertion', delete: 'table-deletion' },
  row: { insert: 'table-row-insertion', delete: 'table-row-deletion' },
  cell: { insert: 'table-cell-insertion', delete: 'table-cell-deletion' },
  image: { insert: 'image-insertion', delete: 'image-deletion' },
};

/**
 * Semantic key implied by a structural insert/delete marker on a table, row,
 * cell, or image target. Inverse of {@link TRACKED_CHANGE_SEMANTIC_TARGET_KINDS} for
 * the structural insert/delete families; `undefined` for other kinds
 * (formatting, moves) which never imply a structural semantic key.
 */
export const structuralSemanticColorKey = (
  kind: string | null | undefined,
  targetKind: 'table' | 'row' | 'cell' | 'image',
): TrackedChangeSemanticColorKey | undefined =>
  kind === 'insert' || kind === 'delete' ? STRUCTURAL_SEMANTIC_KEY_BY_TARGET[targetKind][kind] : undefined;

/**
 * Composes the host `semanticColors` config into a single resolver.
 *
 * Resolution order per key:
 * 1. `overrides[key]` (exact key match).
 * 2. `overrides.move` for `move-from` / `move-to`.
 * 3. `resolve(input)`.
 * 4. The default semantic color for the key.
 *
 * Missing config still enables the built-in defaults, so supported semantic
 * keys receive the requested colors without host configuration. Returns
 * `undefined` only when semantic colors are disabled (`enabled === false`). A
 * throwing host resolver must not break rendering: it falls through to the
 * default color.
 */
export const composeSemanticColorResolver = (
  config?: SemanticColorsConfig | null,
): TrackChangeSemanticColorResolver | undefined => {
  if (config?.enabled === false) return undefined;
  const activeConfig = config ?? {};
  const overrides =
    activeConfig.overrides && typeof activeConfig.overrides === 'object' ? activeConfig.overrides : undefined;
  const resolve = typeof activeConfig.resolve === 'function' ? activeConfig.resolve : undefined;

  return (input: TrackedChangeSemanticColorResolverInput): string | undefined => {
    const key = input?.key;
    if (key == null) return undefined;
    if (overrides) {
      const exactOverride = overrides[key];
      if (isNonEmptyString(exactOverride)) return exactOverride;
      const moveOverride = key === 'move-from' || key === 'move-to' ? overrides.move : undefined;
      if (isNonEmptyString(moveOverride)) return moveOverride;
    }
    if (resolve) {
      try {
        const resolved = resolve(input);
        if (isNonEmptyString(resolved)) return resolved;
      } catch {
        // A throwing host resolver must not break rendering; fall through.
      }
    }
    return defaultSemanticColor(key);
  };
};

const applySemanticColorToLayer = (
  meta: TrackedChangeMeta,
  resolve: TrackChangeSemanticColorResolver | undefined,
): void => {
  const key = meta.semanticColorKey;
  // CSS-only categories (table structure) never carry a JS-resolved color:
  // DomPainter styles them from the `--sd-tracked-changes-table-*` variables.
  const color =
    isConfigurableSemanticColorKey(key) && resolve
      ? resolve({
          key,
          author: authorFromTrackedChangeMeta(meta),
          type: meta.type,
          subtype: meta.subtype,
          targetKind: meta.targetKind,
          semanticAnchorScope: meta.semanticAnchorScope,
        })
      : undefined;
  if (isNonEmptyString(color)) {
    meta.semanticColor = color;
    return;
  }
  // Clear stale semantic color without touching the author `color` field.
  delete meta.semanticColor;
};

const stampRunSemanticColors = (run: TextRun, resolve: TrackChangeSemanticColorResolver | undefined): void => {
  if (Array.isArray(run.trackedChanges)) {
    for (const layer of run.trackedChanges) {
      applySemanticColorToLayer(layer, resolve);
    }
  }
  if (run.trackedChange) {
    applySemanticColorToLayer(run.trackedChange, resolve);
  }
};

const stampBlockSemanticColors = (
  block: FlowBlock | undefined,
  resolve: TrackChangeSemanticColorResolver | undefined,
): void => {
  if (!block) return;
  switch (block.kind) {
    case 'paragraph': {
      for (const run of block.runs) {
        stampRunSemanticColors(run as TextRun, resolve);
      }
      break;
    }
    case 'list': {
      for (const item of block.items) {
        stampBlockSemanticColors(item.paragraph, resolve);
      }
      break;
    }
    case 'table': {
      for (const row of block.rows) {
        // Row-level structural tracked change (e.g. inserted/deleted row).
        if (row.attrs?.trackedChange) {
          applySemanticColorToLayer(row.attrs.trackedChange, resolve);
        }
        for (const cell of row.cells) {
          // Cell-level structural tracked change carrier (SD-3481).
          if (cell.attrs?.trackedChange) {
            applySemanticColorToLayer(cell.attrs.trackedChange, resolve);
          }
          stampBlockSemanticColors(cell.paragraph, resolve);
          if (Array.isArray(cell.blocks)) {
            for (const nested of cell.blocks) {
              stampBlockSemanticColors(nested, resolve);
            }
          }
        }
      }
      break;
    }
    default:
      break;
  }
};

/**
 * Walks every tracked-change layer in the converted FlowBlocks and stamps
 * `meta.semanticColor` from the resolver, based on each layer's
 * `semanticColorKey`. Covers run layers, row-level tracked changes, and the
 * cell-level `TableCellAttrs.trackedChange` carrier.
 *
 * Passing `undefined` (semantic colors disabled or no resolver available)
 * clears any existing `semanticColor`, which prevents stale semantic colors
 * from surviving on reused cached blocks. Missing host config should normally
 * be passed through {@link composeSemanticColorResolver} so defaults apply.
 * Author `color` fields are never read, mutated, or cleared by this pass.
 */
export const stampTrackedChangeSemanticColors = (
  blocks: FlowBlock[],
  resolve: TrackChangeSemanticColorResolver | undefined,
): void => {
  for (const block of blocks) {
    stampBlockSemanticColors(block, resolve);
  }
};
