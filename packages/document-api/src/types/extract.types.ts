import type { CommentStatus, TrackChangeType, TrackChangeWordRevisionIds } from './index.js';

// ---------------------------------------------------------------------------
// extract
// ---------------------------------------------------------------------------

/**
 * Table coordinates for an {@link ExtractBlock} that lives inside a table cell.
 *
 * Blocks inside tables are extracted at paragraph granularity (one entry per
 * paragraph/heading/listItem/image/sdt/tableOfContents in each cell). Group
 * by these fields to reconstruct cells, rows, or whole tables:
 *
 * - cell:  group by `tableOrdinal + rowIndex + columnIndex`
 * - row:   group by `tableOrdinal + rowIndex`
 * - table: group by `tableOrdinal`
 */
export interface ExtractTableContext {
  /** 0-based table ordinal, unique within one `extract()` result. */
  tableOrdinal: number;
  /** Ordinal of the parent table when this block is inside a nested table. */
  parentTableOrdinal?: number;
  /** Row index within the parent table. Only set with `parentTableOrdinal`. */
  parentRowIndex?: number;
  /** Column index within the parent table. Only set with `parentTableOrdinal`. */
  parentColumnIndex?: number;
  /** 0-based row index of the containing cell. */
  rowIndex: number;
  /** 0-based logical grid column of the containing cell, not the row's child order. */
  columnIndex: number;
  /** Number of rows the containing cell spans. 1 for unmerged cells. */
  rowspan: number;
  /** Number of columns the containing cell spans. 1 for unmerged cells. */
  colspan: number;
}

/**
 * Reference to a tracked change applied to one text span.
 *
 * The `entityId` matches an entry in `ExtractResult.trackedChanges`, so
 * consumers can look up author/date or pass it to `scrollToElement()`.
 */
export interface ExtractTextSpanTrackedChange {
  /** Tracked change entity ID. */
  entityId: string;
  /**
   * The mark type carried on this run: insert, delete, or format.
   * Entity-level grouped replacements surface as `replacement` only on
   * `ExtractResult.trackedChanges[]`, not on span marks.
   */
  type: TrackChangeType;
}

/**
 * A contiguous run of text within a block, optionally tagged with the
 * tracked-change marks that apply to it.
 *
 * Spans tile the block's text exactly:
 * `block.textSpans.map(s => s.text).join('') === block.text`.
 *
 * Adjacent runs are coalesced when their `trackedChanges` sets are identical
 * (same `(entityId, type)` pairs, ignoring order). Plain text with no tracked
 * marks is one or more spans with `trackedChanges` omitted.
 *
 * A single span can carry multiple entries when overlapping marks apply, for
 * example a run that is both inserted and bold-tracked.
 */
export interface ExtractTextSpan {
  /** Raw text of the run. Tiles `block.text` when concatenated in order. */
  text: string;
  /** Tracked-change marks applied to this run. Omitted when none apply. */
  trackedChanges?: ExtractTextSpanTrackedChange[];
}

/**
 * One addressable unit of document content.
 *
 * Extraction is paragraph-granular: tables are NOT returned as a single block.
 * Paragraph-like descendants of table cells are emitted individually with
 * `tableContext` attached.
 *
 * Block SDTs (structured document tags / content controls) are transparent:
 * their children emit individually as if they were direct children of the
 * enclosing container. No wrapper `sdt` block is emitted. This prevents
 * SDT-wrapped tables from re-flattening through the wrapper's textContent.
 */
export interface ExtractBlock {
  /** Stable block ID. Pass to `scrollToElement()` for navigation. */
  nodeId: string;
  /** Block type: paragraph, heading, listItem, image, tableOfContents. */
  type: string;
  /** Full plain text content of the block. */
  text: string;
  /**
   * Structured reconstruction of the block's text with tracked-change marks
   * preserved per run. Present only when the block contains at least one
   * tracked change. When concatenated, span text equals `text`.
   */
  textSpans?: ExtractTextSpan[];
  /** Heading level (1-9). Only present for headings. */
  headingLevel?: number;
  /** Table coordinates. Only present for blocks inside a table cell. */
  tableContext?: ExtractTableContext;
}

export interface ExtractComment {
  /** Comment entity ID: pass to `scrollToElement()` for navigation. */
  entityId: string;
  /** Comment body text. */
  text?: string;
  /** The document text the comment is anchored to. */
  anchoredText?: string;
  /** Block ID the comment is anchored to (first segment). */
  blockId?: string;
  /** Comment status. */
  status: CommentStatus;
  /** Comment author name. */
  author?: string;
}

export interface ExtractTrackedChange {
  /** Tracked change entity ID. Pass to `scrollToElement()` for navigation. */
  entityId: string;
  /**
   * Change type at the entity level.
   *
   * In grouped replacement mode (the default), a delete + insert pair shares one entity
   * and `type` is `'replacement'`. Per-half information still lives on
   * `block.textSpans[].trackedChanges[].type`, which is the source of truth
   * for what each run actually represents.
   *
   * In separate replacement mode every revision is its own entity and `type` is the
   * entity's only type. The option that selects it is surface-specific: the browser
   * `Config` takes `trackChanges.replacementMode: 'grouped' | 'separate'`, while the Node
   * SDK and CLI `open` contract takes `trackChanges.replacements: 'paired' | 'independent'`.
   * This type is shared by both, so it names neither as the spelling to use.
   */
  type: TrackChangeType;
  /**
   * Block IDs whose `textSpans` carry this change, in document order. Lets
   * consumers iterate a single tracked change without scanning every block.
   * Omitted when the resolver could not match the change to any block (e.g.
   * orphan marks).
   */
  blockIds?: string[];
  /**
   * Original OOXML `w:id` values (per ECMA-376 §17.13.5) for the marks that
   * make up this entity. In grouped replacement mode, a replacement populates
   * both `insert` and `delete`. In separate replacement mode, only one key is set. Useful
   * for spec-aware consumers that need to map back to the source document.
   */
  wordRevisionIds?: TrackChangeWordRevisionIds;
  /**
   * Short text excerpt of the changed content. Omitted for grouped
   * replacements: the underlying text spans both halves and any single
   * string would either concatenate them (misleading) or pick a side
   * arbitrarily. Read `block.textSpans` for the per-half text instead.
   */
  excerpt?: string;
  /** Change author name. */
  author?: string;
  /** Change date (ISO string). */
  date?: string;
}

export interface ExtractResult {
  /** All blocks in document order with stable IDs and full text. */
  blocks: ExtractBlock[];
  /** All comments with entity IDs and anchored block references. */
  comments: ExtractComment[];
  /** All tracked changes with entity IDs and excerpts. */
  trackedChanges: ExtractTrackedChange[];
  /** Document revision at the time of extraction. */
  revision: string;
}
