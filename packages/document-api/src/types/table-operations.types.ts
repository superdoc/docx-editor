import type {
  BlockNodeAddress,
  TableAddress,
  TableCellAddress,
  TableOrCellAddress,
  TableOrRowAddress,
  TableRowAddress,
} from './base.js';
import type { ReceiptFailure, ReceiptInsert } from './receipt.js';

// ---------------------------------------------------------------------------
// Shared locator types
// ---------------------------------------------------------------------------

/**
 * Locates a table by either a resolved block address or a raw node ID.
 * Used as the base locator for table-scoped operations.
 */
export interface TableLocator {
  target?: TableAddress;
  nodeId?: string;
}

/**
 * Locates a table row. Identical shape to {@link TableLocator} when the
 * target/nodeId already points at a row node.
 */
export interface RowLocator {
  target?: TableRowAddress;
  nodeId?: string;
}

/**
 * Locates a table cell. Identical shape to {@link TableLocator} when the
 * target/nodeId already points at a cell node.
 */
export interface CellLocator {
  target?: TableCellAddress;
  nodeId?: string;
}

/**
 * Locates either a table or one of its rows.
 * Used by row operations that support both direct row targets and table+rowIndex mode.
 */
export interface TableOrRowLocator {
  target?: TableOrRowAddress;
  nodeId?: string;
}

/**
 * Locates either a table or one of its cells.
 * Used by operations that can target the whole table or a specific cell.
 */
export interface TableOrCellLocator {
  target?: TableOrCellAddress;
  nodeId?: string;
}

/**
 * Locates a row by its index within a specific table.
 * Uses the standard {@link TableLocator} fields (target/nodeId) to identify
 * the table, plus a positional `rowIndex` to select the row within it.
 */
export interface TableScopedRowLocator extends TableLocator {
  rowIndex: number;
}

/**
 * Locates a column by its index within a specific table.
 * Uses the standard {@link TableLocator} fields (target/nodeId) to identify
 * the table, plus a positional `columnIndex` to select the column within it.
 */
export interface TableScopedColumnLocator extends TableLocator {
  columnIndex: number;
}

/**
 * Locates a cell by row and column index within a specific table.
 * Uses the standard {@link TableLocator} fields (target/nodeId) to identify
 * the table, plus positional indices to select the cell within it.
 */
export interface TableScopedCellLocator extends TableLocator {
  rowIndex: number;
  columnIndex: number;
}

/**
 * Defines a rectangular range of cells for merge/unmerge operations.
 * Uses the standard {@link TableLocator} fields (target/nodeId) to identify
 * the table, plus start/end coordinates defining the range.
 */
export interface MergeRangeLocator extends TableLocator {
  start: { rowIndex: number; columnIndex: number };
  end: { rowIndex: number; columnIndex: number };
}

// ---------------------------------------------------------------------------
// Shared location / result types
// ---------------------------------------------------------------------------

/**
 * Where to place a table relative to an existing block in the document.
 * Shared by `tables.move`'s `destination` and `create.table`'s `at` (see
 * {@link TableCreateLocation} for the create-only `inParagraph` extension —
 * moving an existing table in place of a paragraph split isn't supported).
 */
export type TableAnchorLocation =
  | { kind: 'documentStart' }
  | { kind: 'documentEnd' }
  | { kind: 'before'; target: BlockNodeAddress }
  | { kind: 'after'; target: BlockNodeAddress }
  | { kind: 'before'; nodeId: string }
  | { kind: 'after'; nodeId: string };

/**
 * Where to place a newly-created table in the document. Extends
 * {@link TableAnchorLocation} with a create-only `inParagraph` kind.
 */
export type TableCreateLocation =
  | TableAnchorLocation
  /**
   * Split the target paragraph at an offset and insert the table as a
   * standalone block between the head/tail halves (Word semantics: a table
   * cannot splice into a paragraph's runs). Offsets are visible-text by
   * default; use `coordinateSpace: 'tracked'` for a deletion-inclusive caret
   * coordinate. Body paragraphs only for now.
   */
  | {
      kind: 'inParagraph';
      target: BlockNodeAddress;
      offset: number;
      coordinateSpace?: 'visible' | 'tracked';
    };

/**
 * Generic success result for table mutation operations.
 *
 * For non-destructive table-targeted mutations, `table` is the canonical
 * post-mutation table reference. Use `table.nodeId` to target the same table
 * in subsequent operations: no intermediate `find()` needed.
 *
 * `table` is `undefined` for destructive operations (delete, convertToText)
 * and in rare cases where post-mutation re-resolution fails.
 */
export interface TableMutationSuccess {
  success: true;
  table?: TableAddress;
  trackedChangeRefs?: ReceiptInsert[];
}

/**
 * Generic failure result for table mutation operations.
 */
export interface TableMutationFailure {
  success: false;
  failure: ReceiptFailure;
}

/**
 * Discriminated union returned by most table mutation operations.
 */
export type TableMutationResult = TableMutationSuccess | TableMutationFailure;

// ---------------------------------------------------------------------------
// create.table
// ---------------------------------------------------------------------------

export interface CreateTableInput {
  rows: number;
  columns: number;
  at?: TableCreateLocation;
}

export interface CreateTableSuccessResult {
  success: true;
  table: TableAddress;
  trackedChangeRefs?: ReceiptInsert[];
}

export type CreateTableResult = CreateTableSuccessResult | TableMutationFailure;

// ---------------------------------------------------------------------------
// tables.convertFromText
// ---------------------------------------------------------------------------

export type ConvertFromTextDelimiter = 'tab' | 'comma' | 'paragraph' | { custom: string };

export interface TablesConvertFromTextInput {
  target?: BlockNodeAddress;
  nodeId?: string;
  delimiter?: ConvertFromTextDelimiter;
  columns?: number;
  inferColumns?: boolean;
}

// ---------------------------------------------------------------------------
// tables.delete  (input: TableLocator)
// tables.clearContents  (input: TableLocator)
// ---------------------------------------------------------------------------

// These operations use `TableLocator` directly as their input type.

// ---------------------------------------------------------------------------
// tables.move
// ---------------------------------------------------------------------------

export interface TablesMoveInput extends TableLocator {
  destination: TableAnchorLocation;
}

// ---------------------------------------------------------------------------
// tables.split
// ---------------------------------------------------------------------------

export type TablesSplitInput = TableScopedRowLocator;

// ---------------------------------------------------------------------------
// tables.convertToText
// ---------------------------------------------------------------------------

export interface TablesConvertToTextInput extends TableLocator {
  delimiter?: 'tab' | 'comma' | 'paragraph';
}

// ---------------------------------------------------------------------------
// tables.setLayout
// ---------------------------------------------------------------------------

export type TableAutoFitMode = 'fixedWidth' | 'fitContents' | 'fitWindow';
export type TableAlignment = 'left' | 'center' | 'right';
export type TableDirection = 'ltr' | 'rtl';
export type TablePreferredWidthType = 'auto' | 'dxa' | 'pct';
export type TablePreferredWidthReadType = TablePreferredWidthType;

export interface TableRowWidthSpec {
  value: number;
  type: TablePreferredWidthType;
}

export interface TablesSetLayoutInput extends TableLocator {
  /**
   * Table preferred width in twips (1/1440 of an inch, 1/20 of a point).
   * Only applies to `fixedWidth` mode. Ignored when `autoFitMode` is `fitWindow`.
   */
  preferredWidth?: number;
  /**
   * Preferred width encoding for `fixedWidth` tables.
   *
   * - `auto` writes `<w:tblW w:w="0" w:type="auto"/>`, allowing fixed-layout
   *   tables whose overall width remains automatic while column widths are
   *   authored separately.
   * - `dxa` writes a twips-based width.
   * - `pct` writes a percentage-based width.
   *
   * When omitted, existing adapter behavior determines the fallback width encoding.
   */
  preferredWidthType?: TablePreferredWidthType;
  alignment?: TableAlignment;
  leftIndentPt?: number;
  autoFitMode?: TableAutoFitMode;
  tableDirection?: TableDirection;
}

// ---------------------------------------------------------------------------
// Row operations
// ---------------------------------------------------------------------------

export type RowInsertPosition = 'above' | 'below';

type DirectRowTargetLocator = { target: TableRowAddress; nodeId?: never };

export type TablesInsertRowInput =
  | (TableScopedRowLocator & { position: RowInsertPosition; count?: number })
  | (DirectRowTargetLocator & { position: RowInsertPosition; count?: number })
  // Table-level locator with no rowIndex/position: appends `count` rows at the
  // end of the table (equivalent to `rowIndex: lastIndex, position: 'below'`).
  | (TableLocator & { rowIndex?: never; position?: never; count?: number });

export type TablesDeleteRowInput = DirectRowTargetLocator | TableScopedRowLocator;

export type TableRowMoveDestination =
  | { kind: 'first' }
  | { kind: 'last' }
  | { kind: 'before'; rowIndex: number }
  | { kind: 'after'; rowIndex: number }
  | { kind: 'before'; target: TableRowAddress }
  | { kind: 'after'; target: TableRowAddress }
  | { kind: 'before'; nodeId: string }
  | { kind: 'after'; nodeId: string };

export type TablesMoveRowInput = (DirectRowTargetLocator | TableScopedRowLocator) & {
  destination: TableRowMoveDestination;
};

export type TablesSetRowHeightInput =
  | (TableScopedRowLocator & { heightPt: number; rule?: 'atLeast' | 'exact' | 'auto' })
  | (DirectRowTargetLocator & { heightPt: number; rule?: 'atLeast' | 'exact' | 'auto' });

/** Uses {@link TableLocator} directly as input. */
export type TablesDistributeRowsInput = TableLocator;

export type TablesSetRowOptionsInput =
  | (TableScopedRowLocator & {
      allowBreakAcrossPages?: boolean;
      repeatHeader?: boolean;
      gridBefore?: number;
      wBefore?: TableRowWidthSpec;
      gridAfter?: number;
      wAfter?: TableRowWidthSpec;
    })
  | (DirectRowTargetLocator & {
      allowBreakAcrossPages?: boolean;
      repeatHeader?: boolean;
      gridBefore?: number;
      wBefore?: TableRowWidthSpec;
      gridAfter?: number;
      wAfter?: TableRowWidthSpec;
    });

// ---------------------------------------------------------------------------
// Column operations
// ---------------------------------------------------------------------------

/**
 * Column insertion position.
 * - `left` / `right` insert relative to `columnIndex`.
 * - `first` / `last` are shortcuts: insert at column 0 or after the last column.
 * - When `columnIndex` is omitted with `left` / `right`, behavior matches
 *   `first` / `last` (LLM-friendly: "right" without a target column means
 *   "rightmost").
 */
export type ColumnInsertPosition = 'left' | 'right' | 'first' | 'last';

export type TablesInsertColumnInput =
  | (TableScopedColumnLocator & { position: 'left' | 'right'; count?: number })
  // Shorthand: any position with table-level locator and no columnIndex.
  | (TableLocator & { position: ColumnInsertPosition; columnIndex?: never; count?: number });

export type TablesDeleteColumnInput = TableScopedColumnLocator;

export interface TablesSetColumnWidthInput extends TableScopedColumnLocator {
  widthPt: number;
}

export interface TablesDistributeColumnsInput extends TableLocator {
  columnRange?: { start: number; end: number };
}

/**
 * Column move destination. Unlike {@link TableRowMoveDestination}, there is
 * no `target`/`nodeId` form — columns have no stable node-id address today
 * (only a positional `columnIndex`), so a move destination is always
 * expressed by index.
 */
export type TableColumnMoveDestination =
  | { kind: 'first' }
  | { kind: 'last' }
  | { kind: 'before'; columnIndex: number }
  | { kind: 'after'; columnIndex: number };

export type TablesMoveColumnInput = TableScopedColumnLocator & {
  destination: TableColumnMoveDestination;
};

// ---------------------------------------------------------------------------
// Cell operations
// ---------------------------------------------------------------------------

export type CellInsertMode = 'shiftRight' | 'shiftDown';
export type CellDeleteMode = 'shiftLeft' | 'shiftUp';

export interface TablesInsertCellInput extends CellLocator {
  mode: CellInsertMode;
}

export interface TablesDeleteCellInput extends CellLocator {
  mode: CellDeleteMode;
}

export type TablesMergeCellsInput = MergeRangeLocator;

export type TablesUnmergeCellsInput = CellLocator | TableScopedCellLocator;

export interface TablesSplitCellInput extends CellLocator {
  rows: number;
  columns: number;
}

export interface TablesSetCellPropertiesInput extends CellLocator {
  preferredWidthPt?: number;
  preferredWidthType?: TablePreferredWidthType;
  verticalAlign?: 'top' | 'center' | 'bottom';
  wrapText?: boolean;
  fitText?: boolean;
}

/**
 * Replace the text content of a single cell with a single paragraph holding
 * `text` (plain text only). Accepts either a direct cell locator or a
 * table-scoped locator (table + rowIndex + columnIndex). Cell properties
 * (vAlign, shading, borders, colspan/rowspan) are preserved.
 */
export type TablesSetCellTextInput = (CellLocator & { text: string }) | (TableScopedCellLocator & { text: string });

// ---------------------------------------------------------------------------
// Data & accessibility
// ---------------------------------------------------------------------------

export type SortDirection = 'ascending' | 'descending';
export type SortType = 'text' | 'number' | 'date';

export interface TablesSortKey {
  columnIndex: number;
  direction: SortDirection;
  type: SortType;
}

export interface TablesSortInput extends TableLocator {
  keys: [TablesSortKey, ...TablesSortKey[]];
}

export interface TablesSetAltTextInput extends TableLocator {
  title?: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// Styling: table style
// ---------------------------------------------------------------------------

export interface TablesSetStyleInput extends TableLocator {
  styleId?: string;
}

export type TablesClearStyleInput = TableLocator;

export type TableStyleOptionFlag =
  | 'headerRow'
  | 'lastRow'
  | 'totalRow' // deprecated alias for 'lastRow': will be removed in a future release
  | 'firstColumn'
  | 'lastColumn'
  | 'bandedRows'
  | 'bandedColumns';

export interface TablesSetStyleOptionInput extends TableLocator {
  flag: TableStyleOptionFlag;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Shared table-formatting types (used by both reads and writes)
// ---------------------------------------------------------------------------

/** Border spec for a single edge. Values are raw OOXML (line style, color). */
export interface TableBorderSpec {
  /** Raw OOXML `ST_Border` value (e.g., `single`, `double`, `dotted`). */
  lineStyle: string;
  /** Border weight in points. Must be positive (0 is rejected). */
  lineWeightPt: number;
  /** Uppercase hex without `#` (e.g., `000000`), or `auto`. */
  color: string;
}

// ---------------------------------------------------------------------------
// Write-only patch types (used by mutation inputs)
// ---------------------------------------------------------------------------

export interface TableMargins {
  topPt: number;
  rightPt: number;
  bottomPt: number;
  leftPt: number;
}

/** Omitted flag = leave unchanged. */
export interface TableStyleOptionsPatch {
  headerRow?: boolean;
  lastRow?: boolean;
  /** @deprecated Use `lastRow` instead. */
  totalRow?: boolean;
  firstColumn?: boolean;
  lastColumn?: boolean;
  bandedRows?: boolean;
  bandedColumns?: boolean;
}

/**
 * Per-edge border patch for writes.
 * - `null` = clear this edge (write explicit "no border")
 * - Omitted = leave this edge unchanged
 */
export interface TableBorderPatch {
  top?: TableBorderSpec | null;
  bottom?: TableBorderSpec | null;
  left?: TableBorderSpec | null;
  right?: TableBorderSpec | null;
  insideH?: TableBorderSpec | null;
  insideV?: TableBorderSpec | null;
}

// ---------------------------------------------------------------------------
// Read-only state types (used by getProperties output)
// ---------------------------------------------------------------------------

/** Absent key = no direct formatting for this flag. */
export interface TableStyleOptionsState {
  headerRow?: boolean;
  lastRow?: boolean;
  firstColumn?: boolean;
  lastColumn?: boolean;
  bandedRows?: boolean;
  bandedColumns?: boolean;
}

/**
 * Three states per edge:
 * - Absent key = no direct formatting on this edge
 * - `null` = explicit direct clear (overrides style-inherited borders)
 * - `TableBorderSpec` = explicit direct border spec
 */
export interface TableBorderState {
  top?: TableBorderSpec | null;
  bottom?: TableBorderSpec | null;
  left?: TableBorderSpec | null;
  right?: TableBorderSpec | null;
  insideH?: TableBorderSpec | null;
  insideV?: TableBorderSpec | null;
}

/** Absent key = no direct formatting for this side. */
export interface TableMarginsState {
  topPt?: number;
  rightPt?: number;
  bottomPt?: number;
  leftPt?: number;
}

// ---------------------------------------------------------------------------
// Convenience operation inputs
// ---------------------------------------------------------------------------

/**
 * Apply a table style and/or style options in one call.
 * At least one of `styleId` or `styleOptions` is required.
 */
export interface TablesApplyStyleInput extends TableLocator {
  /** Table style ID. Not validated against the style catalog. */
  styleId?: string;
  /** Style option flags to merge into `tblLook`. Omitted flags are left unchanged. */
  styleOptions?: TableStyleOptionsPatch;
}

/** Target set for the `applyTo` mode of `setBorders`. */
export type TableBorderApplyTo =
  | 'all'
  | 'outside'
  | 'inside'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'insideH'
  | 'insideV';

/**
 * Set borders on a table. Two modes:
 * - `applyTo`: apply one border spec (or `null` to clear) to a named target set
 * - `edges`: apply a per-edge patch
 */
export type TablesSetBordersInput =
  | (TableLocator & {
      mode: 'applyTo';
      applyTo: TableBorderApplyTo;
      border: TableBorderSpec | null;
    })
  | (TableLocator & {
      mode: 'edges';
      edges: TableBorderPatch;
    });

/**
 * Set table-level default cell margins and/or cell spacing.
 * At least one of `defaultCellMargins` or `cellSpacingPt` is required.
 */
export interface TablesSetTableOptionsInput extends TableLocator {
  /** All four sides required when present. */
  defaultCellMargins?: TableMargins;
  /** Non-negative number, or `null` to clear. */
  cellSpacingPt?: number | null;
}

/**
 * Named visual presets for tables. Each preset composes borders, shading,
 * and conditional-format flags into a polished look.
 *
 * - `grid` — 0.5pt black borders all around, no shading.
 * - `minimal` — no outer borders, hairline grey separators between rows.
 * - `striped` — banded rows on, 0.5pt grey borders all around.
 * - `accent` — header row filled with `accentColor` (default `1F3864`),
 *   thick accent bottom under the header.
 */
export type TablePresetName = 'grid' | 'minimal' | 'striped' | 'accent';

export interface TablesApplyPresetInput extends TableLocator {
  preset: TablePresetName;
  /**
   * Optional accent color (hex; same format as `setShading.color`).
   * Used by presets that need an accent (`accent`). Ignored otherwise.
   */
  accentColor?: string;
}

// ---------------------------------------------------------------------------
// Styling: borders
// ---------------------------------------------------------------------------

export type BorderEdge = 'top' | 'bottom' | 'left' | 'right' | 'insideH' | 'insideV' | 'diagonalDown' | 'diagonalUp';

export interface TablesSetBorderInput {
  target?: TableOrCellAddress;
  nodeId?: string;
  edge: BorderEdge;
  lineStyle: string;
  lineWeightPt: number;
  color: string;
}

export interface TablesClearBorderInput {
  target?: TableOrCellAddress;
  nodeId?: string;
  edge: BorderEdge;
}

export type BorderPreset = 'box' | 'all' | 'none' | 'grid' | 'custom';

export interface TablesApplyBorderPresetInput extends TableLocator {
  preset: BorderPreset;
}

// ---------------------------------------------------------------------------
// Styling: shading
// ---------------------------------------------------------------------------

export interface TablesSetShadingInput {
  target?: TableOrCellAddress;
  nodeId?: string;
  /** Hex color (no `#`), `'auto'`, or `null` to clear (delegates to clearShading). */
  color: string | null;
}

export interface TablesClearShadingInput {
  target?: TableOrCellAddress;
  nodeId?: string;
}

// ---------------------------------------------------------------------------
// Styling: padding & spacing
// ---------------------------------------------------------------------------

export interface TablesSetTablePaddingInput extends TableLocator {
  topPt: number;
  rightPt: number;
  bottomPt: number;
  leftPt: number;
}

export interface TablesSetCellPaddingInput extends CellLocator {
  topPt?: number;
  rightPt?: number;
  bottomPt?: number;
  leftPt?: number;
}

export interface TablesSetCellSpacingInput extends TableLocator {
  spacingPt: number;
}

export type TablesClearCellSpacingInput = TableLocator;

// ---------------------------------------------------------------------------
// Document-level style queries & mutations
// ---------------------------------------------------------------------------

/** Input for `tables.getStyles`: document-level query, no locator needed. */
export type TablesGetStylesInput = Record<string, never>;

/** Per-style metadata returned by `tables.getStyles`. */
export interface TableStyleInfo {
  id: string;
  name: string | null;
  basedOn: string | null;
  isDefault: boolean;
  isCustom: boolean;
  uiPriority: number | null;
  hidden: boolean;
  quickFormat: boolean;
  conditionalRegions: string[];
}

/** Output for `tables.getStyles`. */
export interface TablesGetStylesOutput {
  explicitDefaultStyleId: string | null;
  effectiveDefaultStyleId: string | null;
  effectiveDefaultSource: string;
  styles: TableStyleInfo[];
}

/** Input for `tables.setDefaultStyle`. */
export interface TablesSetDefaultStyleInput {
  styleId: string;
}

/** Input for `tables.clearDefaultStyle`. */
export type TablesClearDefaultStyleInput = Record<string, never>;

// ---------------------------------------------------------------------------
// Read operations (B4: ref handoff)
// ---------------------------------------------------------------------------

/** Input for `tables.get`: locates a single table. */
export type TablesGetInput = TableLocator;

/** Output for `tables.get`: table structure with stable refs. */
export interface TablesGetOutput {
  nodeId: string;
  address: TableAddress;
  rows: number;
  columns: number;
}

/** Input for `tables.getCells`: locates a table and optionally filters cells. */
export interface TablesGetCellsInput extends TableLocator {
  /** Optional row filter. */
  rowIndex?: number;
  /** Optional column filter. */
  columnIndex?: number;
}

/** Per-cell info with stable ref for write handoff. */
export interface TableCellInfo {
  /** First paragraph in this cell, when the engine exposes paragraph identities. */
  firstParagraphNodeId?: string;
  /** Shorthand cell identifier: convenient for logging, Map keys, and display. */
  nodeId: string;
  /** Mutation-ready address: pass directly as `target` in follow-up cell operations. */
  address: TableCellAddress;
  rowIndex: number;
  columnIndex: number;
  colspan: number;
  rowspan: number;
}

/** Output for `tables.getCells`. */
export interface TablesGetCellsOutput {
  nodeId: string;
  address: TableAddress;
  cells: TableCellInfo[];
}

/** Input for `tables.getProperties`: locates a single table. */
export type TablesGetPropertiesInput = TableLocator;

/**
 * Output for `tables.getProperties`: table layout/style metadata.
 *
 * All fields reflect **direct formatting only**. Properties inherited from
 * the table style are not included: use `styleId` and `styleOptions` to
 * determine which style is active.
 */
export interface TablesGetPropertiesOutput {
  nodeId: string;
  address: TableAddress;
  styleId?: string;
  alignment?: TableAlignment;
  direction?: TableDirection;
  /**
   * Table preferred width in twips (1/1440 of an inch, 1/20 of a point).
   * Only present for `fixedWidth` tables. Absent when `autoFitMode` is `fitWindow`.
   */
  preferredWidth?: number;
  /** The encoded OOXML width type when direct table width formatting is present. */
  preferredWidthType?: TablePreferredWidthReadType;
  autoFitMode?: TableAutoFitMode;
  /** Absent when `tblLook` has no direct formatting. Only explicitly stored flags are emitted. */
  styleOptions?: TableStyleOptionsState;
  /** Absent when no direct border formatting exists. Three states per edge (see `TableBorderState`). */
  borders?: TableBorderState;
  /** Default cell margins in points. Only sides with explicit direct formatting are included. */
  defaultCellMargins?: TableMarginsState;
  /** Cell spacing in points. `0` is explicit; absent = no direct formatting. */
  cellSpacingPt?: number;
}
