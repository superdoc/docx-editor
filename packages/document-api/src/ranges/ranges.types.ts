/**
 * Types for the `ranges.resolve` operation: deterministic range construction
 * from explicit document anchors.
 *
 * This is a read-only composition layer that resolves two anchor endpoints
 * into a contiguous `SelectionTarget` plus an optional mutation-ready `ref`.
 */

import type { SelectionTarget, SelectionPoint, TextAddress, TextTarget, EntityAddress } from '../types/address.js';
import type { BlockNodeType } from '../types/base.js';
import type { StoryLocator } from '../types/story.types.js';

// ---------------------------------------------------------------------------
// Anchor types
// ---------------------------------------------------------------------------

/** Anchor at the absolute start or end of the document body. */
export type DocumentEdgeAnchor = {
  kind: 'document';
  edge: 'start' | 'end';
};

/** Anchor at an explicit selection point (text offset or node boundary). */
export type PointAnchor = {
  kind: 'point';
  point: SelectionPoint;
};

/** Anchor derived from an existing ref's start or end boundary. */
export type RefBoundaryAnchor = {
  kind: 'ref';
  ref: string;
  boundary: 'start' | 'end';
};

/**
 * A range endpoint: one of three deterministic anchor forms.
 *
 * - `document`: absolute document boundary (start/end of body)
 * - `point`: explicit `SelectionPoint` (text offset or node edge)
 * - `ref`: boundary of an existing ref from `query.match` or `ranges.resolve`
 */
export type RangeAnchor = DocumentEdgeAnchor | PointAnchor | RefBoundaryAnchor;

// ---------------------------------------------------------------------------
// Input / Output
// ---------------------------------------------------------------------------

export interface ResolveRangeInput {
  /** Start endpoint of the range. */
  start: RangeAnchor;
  /** End endpoint of the range. */
  end: RangeAnchor;
  /** Optional expected revision for consistency checking. */
  expectedRevision?: string;
  /** Story to resolve the range against. Defaults to body when absent. */
  in?: StoryLocator;
}

/** Per-block preview metadata within the resolved range. */
export interface RangeBlockPreview {
  nodeId: string;
  nodeType: BlockNodeType;
  /** Block text clipped to 200 characters. */
  textPreview: string;
}

/** Preview metadata for the resolved range. */
export interface RangePreview {
  /**
   * Concatenated text content across the range.
   * Truncated above 2000 characters; see `truncated`.
   */
  text: string;
  /** Whether `text` was truncated above the 2000-character budget. */
  truncated: boolean;
  /** Per-block preview entries in document order (each textPreview capped at 200 characters). */
  blocks: RangeBlockPreview[];
}

export interface ResolveRangeOutput {
  /** The document revision at which the range was evaluated. */
  evaluatedRevision: string;
  /** Handle metadata for the resolved range. */
  handle: {
    /**
     * Text ref encoding the resolved range when current mutation consumers can
     * use it as a target for delete, replace, or format operations.
     *
     * `null` when the resolved range is not mutation-ready as a ref. Callers
     * must check `handle.ref !== null` and/or `coversFullTarget` before passing
     * the handle to mutation operations.
     */
    ref: string | null;
    refStability: 'ephemeral';
    /**
     * Whether `handle.ref` faithfully covers the exact same range as `target`.
     *
     * `true`: the ref encodes the full range; using it for delete/replace/format
     * produces the same result as operating directly on the target.
     *
     * `false`: the resolved range is not currently exposed as a mutation-ready
     * ref. `handle.ref` may be `null`; callers that need to mutate the range
     * should use another supported target form or re-resolve a narrower range.
     */
    coversFullTarget: boolean;
  };
  /** Transparent selection target for inspection, logging, and debugging. */
  target: SelectionTarget;
  /** Preview metadata describing the content within the range. */
  preview: RangePreview;
}

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

/**
 * Adapter that the document engine implements for `ranges.resolve`.
 *
 * The document-api layer handles validation; the adapter performs the
 * actual ProseMirror-level resolution and ref encoding.
 */
export interface RangeResolverAdapter {
  resolve(input: ResolveRangeInput): ResolveRangeOutput;
}

// ---------------------------------------------------------------------------
// scrollIntoView: input/output value types
// ---------------------------------------------------------------------------

/**
 * Input for `ui.viewport.scrollIntoView`: scrolls the editor
 * viewport so the given target is visible. Handles paginated,
 * virtualized layouts by mounting the target page if it isn't yet in
 * the DOM.
 */
export interface ScrollIntoViewInput {
  /**
   * The target to scroll to. Accepts:
   * - {@link TextAddress}: single-block text range
   * - {@link TextTarget}: multi-segment text target
   * - {@link EntityAddress}: reference to a comment or tracked change by id
   *   (e.g. `{ kind: 'entity', entityType: 'trackedChange', entityId: 'tc_123' }`)
   */
  target: TextAddress | TextTarget | EntityAddress;
  /** Alignment within the viewport. Defaults to `'center'`. */
  block?: 'start' | 'center' | 'end' | 'nearest';
  /**
   * Scroll behavior. Defaults to `'smooth'`. `'auto'` follows the computed
   * CSS `scroll-behavior`; `'instant'` always moves without animation.
   */
  behavior?: 'auto' | 'instant' | 'smooth';
}

/**
 * Result of `ui.viewport.scrollIntoView`. `success: false` when the
 * target couldn't be resolved or a page failed to mount within the
 * navigation timeout.
 */
export interface ScrollIntoViewOutput {
  success: boolean;
}
