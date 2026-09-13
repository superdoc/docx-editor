/**
 * Per-author tracked-change color resolution.
 *
 * Hosts configure per-author colors through `trackChanges.authorColors`
 * on the `superdoc` package. SuperDoc composes those knobs into a single
 * resolver and threads it down into `toFlowBlocks` (see the pm-adapter
 * `AdapterOptions.resolveTrackedChangeColor` field). The pm-adapter calls the
 * composed resolver while preparing FlowBlock data so every tracked-change
 * layer carries a paint-ready `color`; DomPainter then only reads `meta.color`
 * and stamps element-scoped CSS variables.
 *
 * This lives in `@superdoc/contracts` (the shared, publishable foundation) so
 * document adapters and the superdoc package can all import the
 * resolver/types without leaking a private workspace specifier into the
 * published `.d.ts` surface. The painter must never invoke app callbacks or
 * import upstream SuperDoc packages — resolving on the data-preparation side
 * keeps that boundary intact.
 */

import type { FlowBlock, TextRun, TrackChangeAuthor, TrackedChangeMeta } from './index.js';

/**
 * A composed resolver mapping a tracked-change author identity to a color.
 * Returns `undefined` only when the resolver itself declines (it normally
 * falls back to a deterministic color); the field is left absent entirely when
 * per-author colors are disabled.
 */
export type TrackChangeAuthorColorResolver = (author: TrackChangeAuthor) => string | undefined;

/**
 * Host-facing per-author tracked-change color configuration. Mirrors the
 * `trackChanges.authorColors` shape on the public `superdoc` package.
 */
export interface AuthorColorsConfig {
  /** When `false`, per-author colors are not applied. Defaults to enabled. */
  enabled?: boolean;
  /**
   * Color overrides keyed by author identity. Both `email` and `name` keys are
   * supported (email is checked first); matching is exact.
   */
  overrides?: Record<string, string>;
  /**
   * Resolver consulted after `overrides`. Return a CSS color string, or
   * `undefined`/nullish to fall through to the deterministic fallback.
   */
  resolve?: (author: TrackChangeAuthor) => string | undefined | null;
}

/**
 * Curated, high-contrast fallback palette. Used when neither `overrides` nor
 * `resolve` produces a color so imported/discovered authors the host did not
 * configure ahead of time still get a stable, distinct color.
 */
const FALLBACK_PALETTE = [
  '#1f6feb',
  '#d1242f',
  '#8250df',
  '#bf3989',
  '#1a7f37',
  '#9a6700',
  '#bc4c00',
  '#0969da',
  '#cf222e',
  '#6639ba',
  '#116329',
  '#7d4e00',
];

/** Stable identity string for an author (used for hashing + dedupe). */
export const authorIdentityKey = (author: TrackChangeAuthor | undefined): string => {
  if (!author) return '';
  const name = typeof author.name === 'string' ? author.name : '';
  const email = typeof author.email === 'string' ? author.email : '';
  return `${name} ${email}`;
};

/** Deterministic 32-bit FNV-1a hash of a string. */
const hashString = (value: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/**
 * Deterministic fallback color derived from the author identity. The same
 * identity always maps to the same palette entry, so colors stay stable across
 * reloads and across the paint / snapshot surfaces.
 */
export const fallbackAuthorColor = (author: TrackChangeAuthor | undefined): string => {
  const key = authorIdentityKey(author);
  const index = hashString(key) % FALLBACK_PALETTE.length;
  return FALLBACK_PALETTE[index]!;
};

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/**
 * Composes the host `authorColors` config into a single resolver.
 *
 * Resolution order per author:
 * 1. `overrides` by identity — `email` first, then `name` (exact match).
 * 2. `resolve(author)`.
 * 3. A deterministic fallback color from the author identity.
 *
 * Returns `undefined` when colors are disabled (`enabled === false`) or no
 * config was provided, so callers can leave the existing default palette in
 * place by simply not threading a resolver.
 */
export const composeAuthorColorResolver = (
  config?: AuthorColorsConfig | null,
): TrackChangeAuthorColorResolver | undefined => {
  if (!config || config.enabled === false) return undefined;
  const overrides = config.overrides && typeof config.overrides === 'object' ? config.overrides : undefined;
  const resolve = typeof config.resolve === 'function' ? config.resolve : undefined;

  return (author: TrackChangeAuthor): string | undefined => {
    const safeAuthor = author ?? {};
    if (overrides) {
      if (isNonEmptyString(safeAuthor.email) && isNonEmptyString(overrides[safeAuthor.email])) {
        return overrides[safeAuthor.email];
      }
      if (isNonEmptyString(safeAuthor.name) && isNonEmptyString(overrides[safeAuthor.name])) {
        return overrides[safeAuthor.name];
      }
    }
    if (resolve) {
      try {
        const resolved = resolve(safeAuthor);
        if (isNonEmptyString(resolved)) return resolved;
      } catch {
        // A throwing host resolver must not break rendering; fall through.
      }
    }
    return fallbackAuthorColor(safeAuthor);
  };
};

/** Maps tracked-change metadata to the author identity the resolver expects. */
export const authorFromTrackedChangeMeta = (meta: TrackedChangeMeta): TrackChangeAuthor => ({
  name: meta.author,
  email: meta.authorEmail,
  image: meta.authorImage,
});

const applyColorToLayer = (meta: TrackedChangeMeta, resolve: TrackChangeAuthorColorResolver | undefined): void => {
  const color = resolve?.(authorFromTrackedChangeMeta(meta));
  if (isNonEmptyString(color)) {
    meta.color = color;
    return;
  }
  delete meta.color;
};

const stampRunTrackedChangeColors = (run: TextRun, resolve: TrackChangeAuthorColorResolver | undefined): void => {
  if (Array.isArray(run.trackedChanges)) {
    for (const layer of run.trackedChanges) {
      applyColorToLayer(layer, resolve);
    }
  }
  if (run.trackedChange) {
    applyColorToLayer(run.trackedChange, resolve);
  }
};

const stampBlockTrackedChangeColors = (
  block: FlowBlock | undefined,
  resolve: TrackChangeAuthorColorResolver | undefined,
): void => {
  if (!block) return;
  switch (block.kind) {
    case 'paragraph': {
      for (const run of block.runs) {
        stampRunTrackedChangeColors(run as TextRun, resolve);
      }
      break;
    }
    case 'list': {
      for (const item of block.items) {
        stampBlockTrackedChangeColors(item.paragraph, resolve);
      }
      break;
    }
    case 'table': {
      for (const row of block.rows) {
        // Structural row-level tracked change (inserted/deleted row) reuses the
        // same per-author color stamping as inline runs.
        if (row.attrs?.trackedChange) {
          applyColorToLayer(row.attrs.trackedChange, resolve);
        }
        for (const cell of row.cells) {
          if (cell.attrs?.trackedChange) {
            applyColorToLayer(cell.attrs.trackedChange, resolve);
          }
          stampBlockTrackedChangeColors(cell.paragraph, resolve);
          if (Array.isArray(cell.blocks)) {
            for (const nested of cell.blocks) {
              stampBlockTrackedChangeColors(nested, resolve);
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
 * `meta.color` from the resolver. Passing `undefined` clears existing colors,
 * which prevents stale author colors from surviving on reused cached blocks
 * after the host disables per-author colors.
 */
export const stampTrackedChangeColors = (
  blocks: FlowBlock[],
  resolve: TrackChangeAuthorColorResolver | undefined,
): void => {
  for (const block of blocks) {
    stampBlockTrackedChangeColors(block, resolve);
  }
};
