import type { BlockNodeType } from './base.js';
import type { StoryLocator } from './story.types.js';
import type { BookmarkAddress } from '../bookmarks/bookmarks.types.js';

export type Range = {
  /** Inclusive start offset (0-based, UTF-16 code units). */
  start: number;
  /** Exclusive end offset (0-based, UTF-16 code units). */
  end: number;
};

/**
 * Paragraph-local coordinate space used by text offsets.
 *
 * `visible` is the default and counts rendered document text. `tracked` is
 * additive metadata for ranges that intentionally include deletion-side tracked
 * text such as `<w:delText>`.
 */
export type TextCoordinateSpace = 'visible' | 'tracked';

export type TextAddress = {
  kind: 'text';
  captureState?: string;
  blockId: string;
  range: Range;
  /** Story containing this text. Omit for body (backward compatible). */
  story?: StoryLocator;
};

/**
 * A single anchored text segment within one block.
 *
 * Unlike {@link TextAddress} (used for mutation inputs), TextSegment is a
 * lightweight component of a {@link TextTarget}: it carries no `kind`
 * discriminant because the parent TextTarget already provides it.
 */
export type TextSegment = {
  blockId: string;
  range: Range;
};

/**
 * Multi-segment text target returned by comment read operations.
 *
 * A single comment can span multiple discontinuous text ranges (e.g. when Word
 * applies the same comment ID across separate marked runs or across blocks).
 * TextTarget faithfully represents all anchored segments in document order.
 *
 * Invariants:
 * - `segments` is non-empty (at least one segment).
 * - Segments are sorted in document order.
 * - Segment bounds are valid integers (start >= 0, start <= end).
 */
export type TextTarget = {
  kind: 'text';
  captureState?: string;
  segments: [TextSegment, ...TextSegment[]];
  /** Story containing this text target. Omit for body (backward compatible). */
  story?: StoryLocator;
  /** Coordinate space for segment offsets. Omitted means `visible`. */
  coordinateSpace?: TextCoordinateSpace;
};

// ---------------------------------------------------------------------------
// Selection-based mutation targeting
// ---------------------------------------------------------------------------

/**
 * Block node types valid as `nodeEdge` selection anchors.
 *
 * Excludes:
 * - `tableRow`, `tableCell`: row/column semantics out of scope
 */
export type SelectionEdgeNodeType = Exclude<BlockNodeType, 'tableRow' | 'tableCell'>;

export const SELECTION_EDGE_NODE_TYPES = [
  'paragraph',
  'heading',
  'listItem',
  'table',
  'tableOfContents',
  'sdt',
  'image',
] as const satisfies readonly SelectionEdgeNodeType[];

/** Block node address valid as a `nodeEdge` selection anchor. */
export type SelectionEdgeNodeAddress = {
  kind: 'block';
  nodeType: SelectionEdgeNodeType;
  nodeId: string;
  /** Story containing this node. Omit for body (backward compatible). */
  story?: StoryLocator;
};

/**
 * A point within a document selection.
 *
 * - `text`: A character offset within a specific block's flattened text model.
 * - `nodeEdge`: The boundary of a block-level node (before or after).
 */
export type SelectionPoint =
  | {
      kind: 'text';
      blockId: string;
      offset: number;
      /** Story containing this point. Omit for body (backward compatible). */ story?: StoryLocator;
    }
  | { kind: 'nodeEdge'; node: SelectionEdgeNodeAddress; edge: 'before' | 'after' };

/**
 * A contiguous document selection: the canonical public target for the core
 * selection-mutation family (`delete`, `replace`, `format.apply`, `mutations.apply`).
 *
 * Other range-targeted APIs (comments, hyperlinks) continue to use `TextAddress`.
 */
export type SelectionTarget = {
  kind: 'selection';
  captureState?: string;
  start: SelectionPoint;
  end: SelectionPoint;
  /** Story containing this selection. Omit for body (backward compatible). */
  story?: StoryLocator;
  /**
   * Coordinate space for text endpoint offsets. Omitted means `visible`.
   * Present as `tracked` for targets that include deletion-side tracked text,
   * including additive search matches and live review selections.
   */
  coordinateSpace?: TextCoordinateSpace;
};

/** Discriminated input for direct operations: either an explicit target or a ref string. */
export type TargetLocator = { target: SelectionTarget; ref?: undefined } | { ref: string; target?: undefined };

/** Delete behavior mode. */
export type DeleteBehavior = 'selection' | 'exact';

export type EntityType = 'comment' | 'trackedChange';

export type CommentAddress = {
  kind: 'entity';
  entityType: 'comment';
  /**
   * Comment navigation is currently body-scoped only.
   *
   * Unlike bookmark and tracked-change navigation, `navigateTo()` does not yet
   * accept a `story` locator for comments.
   */
  entityId: string;
};

export type TrackedChangeAddress = {
  kind: 'entity';
  entityType: 'trackedChange';
  entityId: string;
  /** Story containing this tracked change. Omit for body (backward compatible). */
  story?: StoryLocator;
  /** Preferred rendered page instance for repeated stories such as headers and footers. */
  pageIndex?: number;
};

export type EntityAddress = CommentAddress | TrackedChangeAddress;

// ---------------------------------------------------------------------------
// Navigation addressing
// ---------------------------------------------------------------------------

/**
 * Address for navigating to a block-level element by its node ID.
 *
 * The `nodeId` maps to `paraId` (from OOXML) when available, with fallback
 * to `sdBlockId` (session-scoped). Use the value returned by Document API
 * queries (e.g. `query.match`, `find`, `getNode`) as the `nodeId`.
 *
 * When `nodeType` is omitted, the lookup searches across all block types.
 *
 * Block navigation is currently body-scoped only. For non-body stories such
 * as headers, footers, footnotes, and endnotes, `navigateTo()` currently
 * supports story-aware bookmark and tracked-change targets instead.
 */
export type BlockNavigationAddress = {
  kind: 'block';
  nodeId: string;
  nodeType?: SelectionEdgeNodeType;
};

/**
 * Union of all address types accepted by `navigateTo()`.
 *
 * Supports navigation to:
 * - Blocks by `nodeId` in the body story
 * - Bookmarks by `name`, optionally scoped to a `story`
 * - Comments by `entityId` in the body story
 * - Tracked changes by `entityId`, optionally scoped to a `story`
 *
 * Story-aware navigation is currently supported for bookmarks and tracked
 * changes. Block and comment targets remain body-only until the runtime gains
 * equivalent non-body resolution paths.
 */
export type NavigableAddress = BlockNavigationAddress | BookmarkAddress | CommentAddress | TrackedChangeAddress;
