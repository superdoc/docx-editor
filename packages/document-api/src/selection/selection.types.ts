import type { SelectionTarget, TextTarget } from '../types/address.js';

export interface SelectionTableCellsTarget {
  kind: 'tableCells';
  selectionMode?: 'cells';
  isRectangular?: true;
  tableId: string;
  start: { rowIndex: number; columnIndex: number };
  end: { rowIndex: number; columnIndex: number };
  story?: SelectionTarget['story'];
}

/** Table/cell context for the selection; bounds alone are not an editing target. */
export interface TableSelectionInfo {
  kind: 'tableCells';
  tableId: string;
  story?: SelectionTarget['story'];
  /** Inclusive logical bounds, including each selected owner's span. */
  start: { rowIndex: number; columnIndex: number };
  end: { rowIndex: number; columnIndex: number };
  /** Whole-table identity requires whole-cell selection intent. */
  type: 'table' | 'cell' | 'cells';
  /** Text context preserves exact character targets; cells denotes whole-cell intent. */
  selectionMode: 'text' | 'cells';
  /** Whether the exact cells fill the bounding rectangle without holes. */
  isRectangular: boolean;
  /** Exact logical owners in row-major order; vertical continuations are deduplicated. */
  cells: { nodeId: string; rowIndex: number; columnIndex: number; rowspan: number; colspan: number }[];
}

export type SelectionExtractOoxmlInput =
  | { at: SelectionTarget | SelectionTableCellsTarget; selection?: never; retain?: boolean }
  | { selection: 'current'; at?: never; retain?: boolean };

export interface SelectionOoxmlDependency {
  sourcePartUri: string;
  relationshipId: string;
  relationshipType: string;
  target: string;
  targetMode: 'Internal' | 'External';
  contentType: string | null;
  /** Base64-encoded target part when the relationship is internal. */
  dataBase64?: string;
}

export interface SelectionExtractOoxmlResult {
  /** Version of the serialized selection-capture manifest. */
  formatVersion: 1;
  /** Same-session exact restoration handle, present only for retain:true. Release when unused. */
  snapshotId?: string;
  at: SelectionTarget | SelectionTableCellsTarget;
  /** Source revision for provenance, never a read precondition. */
  evaluatedRevision: string;
  fragment: {
    placement: 'inline' | 'blocks' | 'table';
    /** Selected WordprocessingML with enough structural wrappers for its placement. */
    xml: string;
    /** Namespace bindings needed to parse the selected fragment. */
    namespaces: Record<string, string>;
    /** Source grid positions for a whole-table or rectangular-cell capture. */
    table?: {
      tableId: string;
      gridColumnCount: number;
      cells: { rowIndex: number; columnIndex: number; gridSpan: number; vMerge: 'none' | 'restart' | 'continue' }[];
    };
  };
  source: {
    story: SelectionTarget['story'] | null;
    partUri: string;
    paragraphStyleId: string | null;
    /** Exact opaque package coordinate for a retained capture, for pairing with committed review UI. */
    packageRevision?: string;
  };
  /** Source structure outside the selected visible content needed to interpret it. */
  context: {
    xml: string[];
    tableMerges?: {
      selectedRowIndex: number;
      columnIndex: number;
      restartRowIndex: number;
      restartCellPropertiesXml: string;
    }[];
  };
  dependencies: SelectionOoxmlDependency[];
  diagnostics: { code: string; message: string }[];
}

/**
 * Input for `selection.current`: reads the editor's current selection.
 *
 * Purely a read operation; does not modify the document. `selection.current`
 * always reflects the live editor selection in whichever story currently
 * holds focus (body, header, footer). Story scoping is not a query
 * parameter here; if a consumer needs a read of a specific story, focus
 * must be set there first.
 */
export interface SelectionCurrentInput {
  /**
   * When `true`, the `text` field of `SelectionInfo` is populated with the
   * quoted text of the selection (useful for comment composers and search).
   * Omit or set `false` to skip text extraction for performance.
   */
  includeText?: boolean;
  includeLogicalChanges?: boolean;
}

/**
 * Canonical shape of the editor's current selection, projected into the
 * Document API's text and table-address models. This is the primitive consumers use
 * to build custom comments UIs, floating toolbars, mention popovers, etc.
 *
 * Unlike PM's `Selection` (positional and private), `SelectionInfo` is
 * portable across rendering backends and stable across layout changes.
 */
export interface SelectionInfo {
  /** True when the selection is empty (cursor only, no range). */
  empty: boolean;
  /**
   * The selection anchored to text content, or `null` when the selection
   * is not in text (empty document, node selection, no focus, etc.).
   *
   * `TextTarget.segments` may contain multiple entries when the selection
   * spans multiple blocks. Pass the whole target to `comments.create` -
   * it resolves multi-segment targets to a single PM range spanning the
   * full selection.
   */
  target: TextTarget | null;
  /** Deletion-inclusive multi-block text coverage for range review decisions, when resolvable. */
  trackedTarget?: TextTarget | null;
  /** Whether this exact text range supports tracked-change decisions; excludes permissions. */
  trackedChangeRangeDecisionSupported?: boolean;
  /** Whether the selection covers every tracked-text fragment of each active change. */
  trackedChangesWhollySelected?: boolean;
  /**
   * Explicit selection envelope for the current live selection, or `null` when
   * the runtime cannot project one truthfully.
   *
   * Unlike {@link target}, this preserves caret/range endpoints in the public
   * selection-target model the write APIs consume directly.
   */
  selectionTarget?: SelectionTarget | null;
  /**
   * V2 browser cell context with inclusive, zero-based logical bounds.
   * Whole-cell selections clear text targets; explicit whole-table handle selections
   * retain resolved formatting targets. Character selections preserve their targets
   * and include the containing cells, including endpoint cells.
   * Exact cell IDs and spans describe merged or nonrectangular selections;
   * only rectangular whole-cell metadata can become a table-cells target.
   */
  tableSelection?: TableSelectionInfo | null;
  /**
   * Active marks at the caret or across the selection. Names are
   * ProseMirror mark type names (e.g. `'bold'`, `'italic'`, `'link'`).
   * Use these to drive toolbar active-state rendering.
   *
   * `activeMarks` uses **intersection** semantics: a name is present
   * only when every character in the selection carries that mark. This
   * matches Word/Google Docs toolbar behavior.
   */
  activeMarks: string[];
  /**
   * Comment IDs whose `commentMark` overlaps any part of the current
   * selection (or covers the caret when empty). Use to drive a
   * floating "comment here" hint, highlight the active sidebar card,
   * or disable a "new comment" button when the selection already
   * covers an existing comment.
   *
   * **Union** semantics: an id is present when *any* character in the
   * selection carries that comment, not when every character does.
   * Multiple overlapping comments produce multiple ids.
   */
  activeCommentIds: string[];
  /**
   * Tracked-change IDs whose `trackInsert` / `trackDelete` /
   * `trackFormat` mark overlaps any part of the current selection.
   * Same union semantics as {@link activeCommentIds}.
   *
   * Use to drive review-sidebar highlighting and next/previous
   * navigation without resolving every change individually via
   * `trackChanges.list()`.
   */
  activeChangeIds: string[];
  logicalChangeIds?: string[];
  /**
   * Quoted text of the selection. Populated only when `includeText: true`.
   * Undefined otherwise.
   */
  text?: string;
}

/** Native source shared by insert and replace; portable captures copy with fresh identities. */
export type OoxmlContentSource =
  | {
      type: 'ooxml';
      value: string;
      namespaces: Record<string, string>;
      dependencies?: SelectionOoxmlDependency[];
      sourcePartUri?: string;
    }
  | { capture: SelectionExtractOoxmlResult };
export interface SelectionReleaseSnapshotInput {
  snapshotId: string;
}
export interface SelectionReleaseSnapshotResult {
  released: boolean;
}
