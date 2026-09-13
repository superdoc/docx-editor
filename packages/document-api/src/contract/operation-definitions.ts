/**
 * Canonical operation definitions: single source of truth for keys, metadata, and paths.
 *
 * Every operation in the Document API is defined exactly once here.
 * All downstream artifacts (COMMAND_CATALOG, OPERATION_MEMBER_PATH_MAP,
 * OPERATION_REFERENCE_DOC_PATH_MAP, REFERENCE_OPERATION_GROUPS) are
 * projected from this object.
 *
 * ## Adding a new operation
 *
 * 1. **Here** (`operation-definitions.ts`): add an entry to `OPERATION_DEFINITIONS`
 *    with `memberPath`, `description`, `expectedResult`, `metadata`, `referenceDocPath`, and `referenceGroup`.
 * 2. **`operation-registry.ts`**: add a type entry (`input`, `options`, `output`).
 *    The bidirectional `Assert` checks will error until this is done.
 * 3. **`invoke.ts`** (`buildDispatchTable`): add a one-line dispatch entry calling
 *    the API method. `TypedDispatchTable` will error until this is done.
 * 4. **Implement**: the API method on `DocumentApi` + its adapter.
 *
 * That's 4 touch points. The catalog, maps, and reference docs are derived
 * automatically. If you forget step 1 or 2, compile-time assertions fail.
 * If you forget step 3, the `TypedDispatchTable` mapped type errors.
 *
 * Import DAG: this file imports only from `metadata-types.ts` and
 * `../types/receipt.js`: no contract-internal circular deps.
 */
import type { ReceiptFailureCode } from '../types/receipt.js';
import type { CommandStaticMetadata, OperationIdempotency, PreApplyThrowCode } from './metadata-types.js';
import { INLINE_PROPERTY_REGISTRY, type InlineRunPatchKey } from '../format/inline-run-patch.js';
// ---------------------------------------------------------------------------
// Reference group key
// ---------------------------------------------------------------------------
export type ReferenceGroupKey =
  | 'core'
  | 'blocks'
  | 'capabilities'
  | 'create'
  | 'sections'
  | 'format'
  | 'format.paragraph'
  | 'styles'
  | 'styles.paragraph'
  | 'templates'
  | 'lists'
  | 'comments'
  | 'trackChanges'
  | 'query'
  | 'mutations'
  | 'tables'
  | 'history'
  | 'toc'
  | 'images'
  | 'hyperlinks'
  | 'headerFooters'
  | 'contentControls'
  | 'bookmarks'
  | 'footnotes'
  | 'clipboard'
  | 'crossRefs'
  | 'index'
  | 'captions'
  | 'fields'
  | 'citations'
  | 'authorities'
  | 'ranges'
  | 'selection'
  | 'diff'
  | 'export'
  | 'protection'
  | 'permissionRanges'
  | 'customXml'
  | 'metadata';
// ---------------------------------------------------------------------------
// Entry shape
// ---------------------------------------------------------------------------
export interface OperationDefinitionEntry {
  memberPath: string;
  description: string;
  expectedResult: string;
  requiresDocumentContext: boolean;
  metadata: CommandStaticMetadata;
  referenceDocPath: string;
  referenceGroup: ReferenceGroupKey;
  skipAsATool?: boolean;
  /** Which intent tool this operation belongs to (e.g. 'edit' → superdoc_edit). */
  intentGroup?: string;
  /** Action enum value within the intent group (e.g. 'insert', 'replace'). */
  intentAction?: string;
}
// ---------------------------------------------------------------------------
// Intent group metadata: tool-level names and descriptions
// ---------------------------------------------------------------------------
export interface IntentGroupMeta {
  toolName: string;
  description: string;
  /**
   * Concrete input examples for LLM tool calling (e.g. Anthropic's input_examples).
   * Each example must be a valid input object for this tool.
   * Kept here (source of truth) and propagated to provider formats during codegen.
   */
  inputExamples?: Record<string, unknown>[];
}

export const V1_RUNTIME_UNAVAILABLE_OPERATION_IDS = [
  'blocks.split',
  'blocks.merge',
  'blocks.move',
  'lists.getState',
  'lists.apply',
  'lists.continue',
  'lists.restart',
  'lists.remove',
  'format.paragraph.setMarkRunProps',
  'tables.moveRow',
  'tables.moveColumn',
] as const;

const V2_BACKED_ONLY_DESCRIPTION_NOTE =
  ' Available on v2-backed sessions only; v1-backed sessions currently return `CAPABILITY_UNAVAILABLE`.';

function v2BackedOnlyDescription(description: string): string {
  return `${description}${V2_BACKED_ONLY_DESCRIPTION_NOTE}`;
}

const FOOTNOTE_STRUCTURED_BODY_V1_NOTE =
  ' Structured `body` content is currently available on v2-backed sessions only; v1-backed sessions return `CAPABILITY_UNAVAILABLE` for those shapes.';

const FIELD_PRESERVE_CACHED_V1_NOTE =
  ' The current v1 runtime supports rebuild flows; `cachedResultText` / `updatePolicy: "preserveCached"` currently return `CAPABILITY_UNAVAILABLE`.';
export const INTENT_GROUP_META: Record<string, IntentGroupMeta> = {
  search: {
    toolName: 'superdoc_search',
    description:
      'Find text patterns or nodes in the document and get ref handles for targeting edits and formatting. ' +
      'Refs expire after any mutation that changes the document. Re-search before the next edit when using individual tools (superdoc_edit, superdoc_format). ' +
      'Within a superdoc_mutations batch, selectors in "where" clauses resolve automatically at compile time; no manual re-searching needed between steps. ' +
      'Text search returns handle.ref covering only the matched substring. Node search finds blocks by type (paragraph, heading, table, listItem, etc.). ' +
      'The "require" parameter controls match cardinality: "first" returns one match, "all" returns every match, "exactlyOne" fails if not exactly one match. ' +
      'Supports scoping via "within" to search inside a single block. ' +
      'Patterns are plain text by default; pass select.mode: "regex" for regular-expression search (g/gi semantics, 1024-char cap, no wholeWord, capture groups returned on matches). Invalid or unsafe patterns fail with INVALID_INPUT. Do NOT use markdown formatting markers (#, **, etc.) in search patterns. ' +
      'Do NOT use this tool when you already have a ref from superdoc_get_content blocks or superdoc_create; use that ref directly.',
    inputExamples: [
      { select: { type: 'text', pattern: 'Introduction' }, require: 'first' },
      { select: { type: 'text', pattern: 'total amount' }, require: 'all' },
      { select: { type: 'node', nodeType: 'heading' }, require: 'all' },
      {
        select: { type: 'text', pattern: 'contract' },
        within: { kind: 'block', nodeType: 'paragraph', nodeId: 'abc123' },
        require: 'first',
      },
    ],
  },
  get_content: {
    toolName: 'superdoc_get_content',
    description:
      'Read document content in various formats. Call this first in any workflow to understand document structure before making edits. ' +
      'Action "blocks" returns structured block data with nodeId, nodeType, textPreview, optional full text when includeText:true, formatting properties (fontFamily, fontSize, color, bold, underline, alignment), and ref handles for immediate use with superdoc_edit or superdoc_format. Its optional reviewMode selects final, original, or redline numbering metadata without filtering blocks. ' +
      'When you need to evaluate or rewrite existing paragraphs or clauses, prefer action "blocks" with includeText:true so you can identify the correct block and then target it by nodeId. ' +
      'Actions "text", "markdown", and "html" return compact strings. Actions "markdown_projection" and "html_projection" return detailed async projections with review modes, scopes, diagnostics, annotations, block maps, and optional source maps. ' +
      'Projection source targets use tracked coordinates and are valid only at evaluatedRevision; after any mutation, reproject before using them. Treat omitted or partially emitted annotations according to their status instead of guessing an anchor from rendered text. ' +
      'Action "info" returns document metadata: word count, paragraph count, page count, outline, available styles, and capability flags. ' +
      'The "blocks" action supports pagination via "offset" and "limit", filtering via "nodeTypes", and numbering projection via "reviewMode". Other actions ignore pagination and filtering parameters. ' +
      'This tool never modifies the document. ' +
      'Do NOT call superdoc_edit or superdoc_format without first reading blocks to get valid refs and formatting reference values.',
    inputExamples: [
      { action: 'blocks' },
      { action: 'blocks', includeText: true, offset: 0, limit: 20, reviewMode: 'final' },
      { action: 'blocks', offset: 0, limit: 20, nodeTypes: ['heading', 'paragraph'] },
      { action: 'text' },
      { action: 'info' },
      { action: 'html_projection', reviewMode: 'redline', includeSourceMap: true },
      {
        action: 'markdown_projection',
        reviewMode: 'original',
        scope: { kind: 'block', nodeType: 'paragraph', nodeId: 'paragraph-id' },
        includeSourceMap: true,
      },
    ],
  },
  edit: {
    toolName: 'superdoc_edit',
    description:
      'The primary tool for inserting content into documents. ' +
      'ALWAYS use action "insert" with type "markdown" to create headings, paragraphs, or any block content: this is faster and creates proper document structure in one call. Do NOT use superdoc_create for headings or paragraphs. ' +
      'The markdown parser creates headings from # markers (# = Heading1, ## = Heading2), bold from **text**, italic from *text*, and numbered/bullet lists. ' +
      'Position markdown inserts with "target" (a BlockNodeAddress like {kind:"block", nodeType, nodeId}) and "placement" (before, after, insideStart, insideEnd). Without a target, content appends at the end of the document. ' +
      'IMPORTANT: After a markdown insert, analyze the document context (what kind of document, how titles and body text are styled) and follow up with ONE superdoc_mutations call to format inserted blocks so they look like they belong. ' +
      'Each format.apply step accepts "inline" (fontFamily, fontSize, bold, underline, color), "alignment", and "scope" in the same step. ' +
      'Use scope: "block" so formatting covers the entire paragraph. ' +
      'Copy the exact property values from the existing get_content blocks (fontFamily, fontSize, color, alignment, bold, underline). Do NOT invent values: use what the blocks show. ' +
      'Also supports replace, delete, and undo/redo. For ordinary replace and delete, pass a "ref" from superdoc_search or superdoc_get_content blocks. ' +
      'A search ref covers only the matched substring; a block ref covers the entire block text, so use block refs when rewriting or shortening whole paragraphs. ' +
      'To replace every block in the main body, use action "replace" with target:{kind:"story",storyType:"body"}, one text/value/content payload, and changeMode:"direct". This replaces body content, not the DOCX package, and does not require a search first. Tracked whole-body replacement is unsupported. ' +
      'For multi-step redlines or whole-clause rewrites, prefer superdoc_mutations with where:{by:"block", nodeType, nodeId} from superdoc_get_content action "blocks" includeText:true rather than relying on text selectors. ' +
      'Refs expire after any mutation; always re-search before the next edit. ' +
      'For 2+ edits that must succeed or fail atomically, use superdoc_mutations instead. ' +
      'Before an exact HTML or Markdown insert/replace that must be fidelity-checked, use action "check_support", review its outcome and diagnostics, then pass its guard back as "supportCheck" on the unchanged write. ' +
      'Supports "dryRun" to preview changes and "changeMode: tracked" to record edits as tracked changes. ' +
      'Do NOT build "target" objects manually when a ref is available; prefer "ref" for simpler, more reliable targeting.',
    inputExamples: [
      {
        action: 'insert',
        type: 'markdown',
        target: { kind: 'block', nodeType: 'paragraph', nodeId: '<nodeId>' },
        placement: 'before',
        value: '# Executive Summary\n\nThis agreement sets forth the principal terms...',
        changeMode: 'direct',
      },
      {
        action: 'insert',
        type: 'html',
        value: '<h2>Review heading</h2><p>Tracked rich content.</p>',
        changeMode: 'tracked',
      },
      {
        action: 'insert',
        type: 'markdown',
        value:
          '# Section Title\n\nParagraph content here.\n\n# Another Section\n\nMore content with **bold** and *italic*.',
      },
      { action: 'replace', ref: '<handle.ref>', text: 'new text here' },
      {
        action: 'replace',
        ref: '<handle.ref>',
        value: '**Direct rich replacement**',
        type: 'markdown',
        changeMode: 'direct',
      },
      {
        action: 'replace',
        ref: '<handle.ref>',
        value: '<strong>Tracked rich replacement</strong>',
        type: 'html',
        changeMode: 'tracked',
      },
      {
        action: 'check_support',
        operation: 'insert',
        input: { type: 'markdown', value: '# Checked section' },
        options: { changeMode: 'direct' },
      },
      {
        action: 'replace',
        target: { kind: 'story', storyType: 'body' },
        value: '# Replacement\n\nComplete new body.',
        type: 'markdown',
        changeMode: 'direct',
      },
      { action: 'delete', ref: '<handle.ref>' },
      { action: 'undo' },
    ],
  },
  create: {
    toolName: 'superdoc_create',
    description:
      'IMPORTANT: For headings and paragraphs, use superdoc_edit with type "markdown" instead: it is faster, creates proper styles, and handles positioning via target + placement. ' +
      'Only use superdoc_create for tables or when markdown cannot express the content. ' +
      'Creates a single paragraph, heading, or table. Returns nodeId and ref for the created block. ' +
      'After creating, the returned ref is valid for ONE immediate superdoc_format call. For subsequent operations, re-fetch blocks with superdoc_get_content to get fresh refs (refs expire after any mutation). ' +
      'When the user asks for a "heading", use action "heading" with a level (default 1). Use action "paragraph" for regular body text. ' +
      'Position with "at": {kind:"documentEnd"} (default), {kind:"documentStart"}, or {kind:"after"/"before", target:{kind:"block", nodeType, nodeId}} for relative placement. ' +
      'When creating multiple items in sequence, use the previous response nodeId as the next "at" target to maintain correct ordering. ' +
      'Do NOT use newlines in "text" to create multiple paragraphs; call this tool separately for each one.',
    inputExamples: [
      { action: 'paragraph', text: 'New paragraph content.', at: { kind: 'documentEnd' } },
      {
        action: 'heading',
        text: 'Section Title',
        level: 2,
        at: { kind: 'after', target: { kind: 'block', nodeType: 'paragraph', nodeId: '<nodeId>' } },
      },
      {
        action: 'paragraph',
        text: 'Chained item.',
        at: { kind: 'after', target: { kind: 'block', nodeType: 'paragraph', nodeId: '<previousNodeId>' } },
      },
      { action: 'table', rows: 3, columns: 4, at: { kind: 'documentEnd' } },
    ],
  },
  format: {
    toolName: 'superdoc_format',
    description:
      'Change text and paragraph formatting. ' +
      'To format multiple items at once, use superdoc_mutations with format.apply steps instead of calling this tool repeatedly. Use require "all" with a node selector to format every heading or paragraph in one batch. ' +
      'Use this tool for single-item formatting when you have a valid ref or nodeId. ' +
      'Action "inline" applies character formatting (bold, italic, underline, color, fontSize, fontFamily, highlight, strike, vertAlign) to a text range via "ref". ' +
      'Action "set_style" applies a named paragraph style by styleId (get available styles from superdoc_get_content info). ' +
      'Actions "set_alignment", "set_indentation", "set_spacing", "set_direction", and "set_flow_options" change paragraph-level properties and require a block target: {kind:"block", nodeType:"paragraph", nodeId:"<nodeId>"}, NOT a ref. ' +
      'Use "set_flow_options" with pageBreakBefore:true to start a paragraph on a new page. ' +
      'Supports "dryRun" and "changeMode: tracked" for inline formatting. Paragraph-level actions do NOT support tracked changes. ' +
      'Do NOT use a search ref for paragraph-level actions; they require a block target with nodeId. ' +
      'Do NOT use {kind:"block", start:{kind:"nodeEdge",...}} or selection-like structures for paragraph actions. ONLY {kind:"block", nodeType, nodeId} is accepted. ' +
      'Do NOT issue multiple superdoc_format calls in parallel; each call invalidates refs for subsequent calls.',
    inputExamples: [
      { action: 'inline', ref: '<handle.ref>', inline: { bold: true } },
      {
        action: 'inline',
        ref: '<create.ref>',
        inline: { fontFamily: 'Calibri', fontSize: 11, color: '#000000', bold: false },
      },
      {
        action: 'set_alignment',
        target: { kind: 'block', nodeType: 'paragraph', nodeId: '<nodeId>' },
        alignment: 'center',
      },
      {
        action: 'set_flow_options',
        target: { kind: 'block', nodeType: 'paragraph', nodeId: '<nodeId>' },
        pageBreakBefore: true,
      },
      {
        action: 'set_spacing',
        target: { kind: 'block', nodeType: 'paragraph', nodeId: '<nodeId>' },
        lineSpacing: { rule: 'auto', value: 1.5 },
      },
    ],
  },
  table: {
    toolName: 'superdoc_table',
    description:
      'Create and modify table structure, content, and styling. Find table/row/cell nodeIds via superdoc_get_content({action:"blocks"}) or superdoc_search.\n' +
      '\n' +
      'ACTIONS:\n' +
      '• Structure: delete, insert_row, delete_row, insert_column, delete_column, merge_cells, unmerge_cells.\n' +
      '• Cell content: set_cell_text (text). set_cell (vAlign / wrap / fit / preferred width).\n' +
      '• Row / column: set_row (height + rule), set_row_options (repeat-header, allow-break), set_column (widthPt).\n' +
      '• Table styling: set_borders, set_shading, set_style_options (headerRow / bandedRows / firstColumn / lastColumn / lastRow / bandedColumns), set_layout (autofit / alignment / direction / preferredWidth), set_options (default cell margins + cell spacing).\n' +
      '\n' +
      'LOCATORS (the shapes ops accept):\n' +
      '• insert_row append shorthand: { nodeId: "<tableId>" } with no rowIndex/position appends at the end. Three other forms: target a row + position, table + rowIndex + position, or any of the above with count:N for multiple.\n' +
      '• insert_column shorthand: position:"first"|"last" with no columnIndex. Otherwise columnIndex + position:"left"|"right".\n' +
      '• merge_cells: table target + start:{rowIndex, columnIndex} + end:{rowIndex, columnIndex}.\n' +
      '• set_cell_text: table target + rowIndex + columnIndex (preferred) OR cell target.\n' +
      '• set_cell: cell target only. Does NOT accept table+rowIndex+columnIndex.\n' +
      '• set_borders / set_shading: table OR cell target. NOT a row target.\n' +
      '\n' +
      'COLOR FORMAT:\n' +
      'Hex strings accept #RRGGBB, RRGGBB, #RGB, or 3-digit RGB; also "auto"; also null to clear (where supported). Stored canonically as uppercase RRGGBB. Always pass a concrete color when one is implied. Never call set_borders with `auto` for a "make it look [X]" ask.\n' +
      '\n' +
      'STYLING (TWO MODES):\n' +
      '\n' +
      'A. STRUCTURAL CHANGE → re-apply the existing styling.\n' +
      "   Triggers: insert_row / insert_column / delete_row / delete_column / merge_cells / unmerge_cells. (NOT set_cell_text or set_cell: those don't disturb borders/shading.)\n" +
      '   Recipe: read the current borders/shading/cnf flags via superdoc_get_content({action:"blocks"}) before the change, then re-apply the SAME values after with set_borders + set_shading + set_style_options. The goal is consistency, not a redesign.\n' +
      '   Skip on a freshly created table. A new table starts un-styled.\n' +
      '\n' +
      'B. STYLE-CHANGE REQUEST ("make it look [X]" / "style the whole table") → apply the FULL set with concrete colors.\n' +
      '   Touch every axis: borders, shading, text alignment, font color/weight, cnf flags, spacing. A single set_borders call without shading and font tweaks always looks half-finished. That\'s the #1 cause of "no visual change" complaints.\n' +
      '   Color palette: discover the document\'s palette by reading superdoc_get_content({action:"blocks"}) and reusing the colors on existing tables/headings. When no palette is obvious, default to corporate blue "1F3864" or dark grey "444444" for accents and "F2F2F2" / "E7E6E6" for banding.\n' +
      '   Recipe (call ALL of these):\n' +
      '     1. set_borders applyTo:"all" with an explicit color and weight.\n' +
      '     2. set_shading on the header row cells with the accent color. Add banding on alternate body rows if appropriate.\n' +
      '     3. set_style_options { headerRow: true, bandedRows?: true } so cnf regions are recognized.\n' +
      '     4. Cell-text alignment via superdoc_format action:"set_alignment". Center the header, left-align body, right-align numeric columns. Paragraph-level: target the paragraph inside each cell.\n' +
      '     5. Font color + weight via superdoc_format action:"inline". Header gets a contrasting color (white on dark fill, accent on light fill) plus bold:true.\n' +
      '     6. set_options if the user asks for tighter or looser spacing.\n' +
      '   Steps 4–5 cross to superdoc_format. Use superdoc_mutations to batch many format.apply steps in one call.\n' +
      '\n' +
      'AFTER set_cell_text, match the new cell to its siblings:\n' +
      'set_cell_text writes plain text with the document\'s default font/size/color and no weight. Always follow up with one superdoc_format inline call copying fontFamily/fontSize/color/bold from a sibling cell (or any non-empty body paragraph if the table is fresh and has no sibling content). If sibling cells show a bold-prefix pattern like "Label: value", replicate it on the new cell via superdoc_search + superdoc_format inline (or one superdoc_mutations batch with format.apply steps).\n' +
      '\n' +
      'LIST-TO-TABLE:\n' +
      '(1) superdoc_create action:"table" with the desired rows/columns. (2) Populate cells with set_cell_text using rowIndex/columnIndex (one call per cell). (3) DELETE THE WHOLE LIST in one call: superdoc_list({action:"delete", target:{kind:"block", nodeType:"listItem", nodeId:"<any-item-id>"}}). The op walks the contiguous list and removes all items.\n' +
      'Wrong paths for list deletion (all leave bullets/empty paragraphs behind): text.delete, superdoc_edit action:"delete" on text refs, lists.detach, lists.convertToText.',
    // One canonical example per non-obvious shape. Other actions follow the
    // same {action, nodeId, ...args} pattern documented in the prose above.
    inputExamples: [
      // Append a row at the end (no rowIndex/position needed).
      { action: 'insert_row', nodeId: '<tableNodeId>' },
      // Insert a column at the end (use 'first' / 'last' to skip columnIndex).
      { action: 'insert_column', nodeId: '<tableNodeId>', position: 'last' },
      // Merge a rectangular range.
      {
        action: 'merge_cells',
        nodeId: '<tableNodeId>',
        start: { rowIndex: 0, columnIndex: 0 },
        end: { rowIndex: 1, columnIndex: 1 },
      },
      // Fill a cell with text using table+row+col coordinates.
      { action: 'set_cell_text', nodeId: '<tableNodeId>', rowIndex: 0, columnIndex: 0, text: 'Q1 Revenue' },
      // Set row height (rule: atLeast | exact | auto).
      { action: 'set_row', nodeId: '<tableNodeId>', rowIndex: 0, heightPt: 24, rule: 'atLeast' },
      // Border with a hex color (accepts #RRGGBB, RRGGBB, #RGB, RGB, or 'auto').
      {
        action: 'set_borders',
        nodeId: '<tableNodeId>',
        mode: 'applyTo',
        applyTo: 'all',
        border: { lineStyle: 'single', lineWeightPt: 1, color: '#000000' },
      },
      // Shade a single cell (use color: null to clear, or apply to a table nodeId for whole-table fill).
      {
        action: 'set_shading',
        target: { kind: 'block', nodeType: 'tableCell', nodeId: '<cellNodeId>' },
        color: '#E3F2FD',
      },
      // Toggle one or more cnf flags in a single call.
      {
        action: 'set_style_options',
        nodeId: '<tableNodeId>',
        styleOptions: { headerRow: true, bandedRows: true },
      },
    ],
  },
  list: {
    toolName: 'superdoc_list',
    description:
      'Create and manipulate bullet and numbered lists. ' +
      'Most actions require a list-item target: {kind:"block", nodeType:"listItem", nodeId:"<id>"}. ' +
      'Exceptions: "create" and "attach" operate on paragraph targets (they turn paragraphs into list items). ' +
      'Find nodeIds via superdoc_get_content({action:"blocks"}): pick listItem blocks for most actions, paragraph blocks for create/attach.\n' +
      '\n' +
      'CREATE & CONVERT:\n' +
      '• "create": make a NEW list from paragraphs. Two modes: ' +
      'mode:"empty" with at:{kind:"block", nodeType:"paragraph", nodeId} converts a single paragraph; ' +
      'mode:"fromParagraphs" with target:{from:{...paragraph block address}, to:{...paragraph block address}} converts a range: ALL paragraphs between from and to become items, so make sure no other content sits between them. ' +
      'Pass a preset ("disc"|"circle"|"square"|"dash" for bullets; "decimal"|"decimalParenthesis"|"lowerLetter"|"lowerLetterParenthesis"|"upperLetter"|"upperLetterParenthesis"|"lowerRoman"|"upperRoman" for ordered) or a custom style. ' +
      'Use "create" to start a fresh list: NOT to extend an existing one (use "attach" for that).\n' +
      '• "attach": add paragraphs to an EXISTING list, inheriting its numbering definition. Pass target:{paragraph block address} (or {from, to} range of paragraphs) + attachTo:{kind:"block", nodeType:"listItem", nodeId:"<any item in destination list>"} + optional level:0..8. Use this to extend a list or as the second half of a merge workflow (see "join" below).\n' +
      '• "set_type": convert an existing list between ordered and bullet. Pass target:{listItem} + kind:"ordered" or "bullet". Adjacent compatible sequences are merged automatically to preserve continuous numbering.\n' +
      '• "detach": convert a list item back to a plain paragraph. Pass target:{listItem}.\n' +
      '\n' +
      'ITEMS & NESTING:\n' +
      '• "insert": add a new list item adjacent to an existing item in the same list. Pass target:{listItem} + position:"before"|"after" + optional text. Use this (NOT superdoc_create) to add items to an existing list.\n' +
      '• "indent" / "outdent": bump the target item\'s nesting level by one (0-8 range). Pass target:{listItem}.\n' +
      '• "set_level": jump the target item to an explicit level. Pass target:{listItem} + level:0..8.\n' +
      '\n' +
      'NUMBERING (ordered lists):\n' +
      '• "set_value": restart numbering at the target. Pass target:{listItem} + value:<number> (e.g. value:1 to start over) or value:null to clear a previous override. Mid-sequence targets are atomically split off into their own sequence.\n' +
      '• "continue_previous": make the target\'s sequence continue numbering from the nearest compatible previous sequence (same abstract definition). Pass target:{listItem of the sequence you want to renumber}. Fails with NO_COMPATIBLE_PREVIOUS or INCOMPATIBLE_DEFINITIONS if no matching prior sequence exists.\n' +
      '\n' +
      'SEQUENCE SHAPE (merge / split):\n' +
      '• "merge": merge the target\'s sequence with an adjacent one into one continuous list. Pass target:{listItem} + direction:"withPrevious" or "withNext". Absorbed items adopt the absorbing sequence\'s numbering definition, and empty paragraphs between the two sequences are removed so numbering flows continuously.\n' +
      '• "split": split the target\'s sequence at the target item into two independent lists. The target and everything after become a new sequence that restarts numbering at 1. Pass target:{listItem}; add restartNumbering:false to keep the count continuing instead of restarting.',
    inputExamples: [
      {
        action: 'create',
        mode: 'fromParagraphs',
        preset: 'disc',
        target: {
          from: { kind: 'block', nodeType: 'paragraph', nodeId: '<firstId>' },
          to: { kind: 'block', nodeType: 'paragraph', nodeId: '<lastId>' },
        },
      },
      { action: 'set_type', target: { kind: 'block', nodeType: 'listItem', nodeId: '<itemId>' }, kind: 'ordered' },
      {
        action: 'insert',
        target: { kind: 'block', nodeType: 'listItem', nodeId: '<itemId>' },
        position: 'after',
        text: 'New list item',
      },
      { action: 'indent', target: { kind: 'block', nodeType: 'listItem', nodeId: '<itemId>' } },
      {
        action: 'merge',
        target: { kind: 'block', nodeType: 'listItem', nodeId: '<itemId>' },
        direction: 'withPrevious',
      },
      { action: 'split', target: { kind: 'block', nodeType: 'listItem', nodeId: '<itemId>' } },
      { action: 'set_value', target: { kind: 'block', nodeType: 'listItem', nodeId: '<itemId>' }, value: 1 },
      { action: 'continue_previous', target: { kind: 'block', nodeType: 'listItem', nodeId: '<itemId>' } },
    ],
  },
  comment: {
    toolName: 'superdoc_comment',
    description:
      'Manage document comment threads: create, read, update, and delete. ' +
      'To create a comment, first use superdoc_search to find the target text, then pass action "create" with the comment text and a target built from items[0].blocks. For a single-block match use {kind:"text", blockId: items[0].blocks[0].blockId, range: items[0].blocks[0].range}. For a cross-block match use {kind:"text", segments: items[0].blocks.map(b => ({blockId: b.blockId, range: b.range}))}. Do NOT use items[0].highlightRange (snippet-relative, not block-relative) or items[0].target (a SelectionTarget, not accepted by comments.create). ' +
      'For threaded replies, pass "parentId" with the parent comment ID. ' +
      'Action "list" returns all comments with optional pagination (limit, offset) and filtering (includeResolved:true to include resolved). ' +
      'Action "get" retrieves a single comment by ID. Action "update" changes comment text, re-anchors the thread, changes status to "resolved", or toggles the legacy `sdcom:internal` flag for v1 compatibility. Action "delete" removes a comment or reply by ID. ' +
      'Do NOT pass "ref", "id", or "parentId" when creating a new top-level comment; "action", "text", and "target" are required, while commentId (the v1 compatibility alias for externalId), externalId, author fields, and metadata are optional correlation fields.',
    inputExamples: [
      {
        action: 'create',
        text: 'Please review this section.',
        target: { kind: 'text', blockId: '<blockId>', range: { start: 5, end: 25 } },
      },
      { action: 'list', limit: 20, offset: 0 },
      { action: 'update', id: '<commentId>', status: 'resolved' },
      { action: 'delete', id: '<commentId>' },
    ],
  },
  track_changes: {
    toolName: 'superdoc_track_changes',
    description:
      'Review and resolve tracked changes (insertions, deletions, replacements, format changes) in the document. ' +
      'Action "list" returns all tracked changes with optional filtering by type (insert, delete, replacement, format) and pagination (limit, offset). Each change includes an ID, type, author, timestamp, and content preview. ' +
      'Action "decide" accepts or rejects changes. Pass decision:"accept" to apply the change permanently, or decision:"reject" to discard it. ' +
      'Target a single change with {id:"<changeId>"}, several whole changes atomically with {kind:"ids", ids:[...]}, a partial selection with {kind:"range", range:{...}}, or all changes at once with {scope:"all"} (optionally plus story). ' +
      'Do NOT use this tool unless the document has tracked changes. Use superdoc_get_content info to check the tracked change count first.',
    inputExamples: [
      { action: 'list' },
      { action: 'list', type: 'insertion', limit: 10 },
      { action: 'list', type: 'replacement', limit: 10 },
      { action: 'decide', decision: 'accept', target: { id: '<changeId>' } },
      { action: 'decide', decision: 'accept', target: { kind: 'ids', ids: ['<changeId1>', '<changeId2>'] } },
      {
        action: 'decide',
        decision: 'reject',
        target: {
          kind: 'range',
          range: { kind: 'text', segments: [{ blockId: '<blockId>', range: { start: 0, end: 5 } }] },
        },
      },
      { action: 'decide', decision: 'reject', target: { scope: 'all' } },
    ],
  },
  link: { toolName: 'superdoc_link', description: 'Manage hyperlinks' },
  image: { toolName: 'superdoc_image', description: 'Image placement and properties' },
  section: { toolName: 'superdoc_section', description: 'Page layout, margins, columns' },
  mutations: {
    toolName: 'superdoc_mutations',
    description:
      'All steps succeed or all fail; no partial application. ' +
      'Execute multiple operations atomically in one batch. Use this for any workflow needing 2+ changes. ' +
      'Supported step types: text (text.rewrite, text.insert, text.delete), format (format.apply), create (create.heading, create.paragraph, create.table), assert. ' +
      'Each step has an id, an op, a "where" clause for targeting ({by:"select", select:{...}, require:"first"|"exactlyOne"|"all"} or {by:"ref", ref:"..."} or {by:"block", nodeType:"paragraph", nodeId:"..."}), and "args" with operation-specific parameters. ' +
      'Use {by:"block", nodeType, nodeId} when you want to rewrite, delete, format, or anchor against a whole known block from superdoc_get_content action "blocks" without relying on text matching. ' +
      'For full-paragraph or full-clause rewrites, first call superdoc_get_content with action:"blocks" and includeText:true, then rewrite the matching block by nodeId. ' +
      'Use {by:"select"} only for substring edits, discovery, or insertion relative to a sentence fragment; do NOT use a shortened text selector to replace an entire known block. ' +
      'For create steps, "where" targets an existing anchor block and args.position ("before" or "after") controls placement. Sequential creates targeting the same anchor maintain correct order via internal position mapping. ' +
      'For format.apply with require "all", use a node selector to format every heading or paragraph at once: {by:"select", select:{type:"node", nodeType:"heading"}, require:"all"}. ' +
      'Selectors resolve at compile time (before execution). This means format.apply steps CANNOT target content created by earlier create steps in the same batch. Split creates and formatting into separate batches: first a mutations call with creates, then a mutations call with format.apply. ' +
      'Action "preview" dry-runs the plan. Action "apply" executes it. ' +
      'If a selector matches nothing, the failure reports the step id plus selector details so you can retry with a shorter or more distinctive anchor. ' +
      'Do NOT create two steps that target overlapping text in the same block; combine them into a single text.rewrite step.',
    inputExamples: [
      {
        action: 'apply',
        atomic: true,
        changeMode: 'direct',
        steps: [
          {
            id: 's1',
            op: 'text.rewrite',
            where: { by: 'select', select: { type: 'text', pattern: 'old term' }, require: 'all' },
            args: { replacement: { text: 'new term' } },
          },
          {
            id: 's2',
            op: 'text.delete',
            where: { by: 'select', select: { type: 'text', pattern: ' (deprecated)' }, require: 'all' },
            args: {},
          },
        ],
      },
      {
        action: 'apply',
        steps: [
          {
            id: 'r1',
            op: 'text.rewrite',
            where: { by: 'block', nodeType: 'paragraph', nodeId: '<nodeId>' },
            args: { replacement: { text: 'Updated clause text.' } },
          },
          {
            id: 'f1',
            op: 'format.apply',
            where: { by: 'select', select: { type: 'node', nodeType: 'heading' }, require: 'all' },
            args: { inline: { color: '#FF0000' } },
          },
          {
            id: 'f2',
            op: 'format.apply',
            where: { by: 'select', select: { type: 'text', pattern: 'Confidential Information' }, require: 'all' },
            args: { inline: { bold: true } },
          },
        ],
      },
    ],
  },
};
// ---------------------------------------------------------------------------
// Metadata helpers (moved from command-catalog.ts)
// ---------------------------------------------------------------------------
const NONE_FAILURES: readonly ReceiptFailureCode[] = [];
const NONE_THROWS: readonly PreApplyThrowCode[] = [];
const INVALID_FRAGMENT_FAILURES: readonly ReceiptFailureCode[] = ['INVALID_FRAGMENT'];
const FOOTNOTE_MUTATION_FAILURES: readonly ReceiptFailureCode[] = ['INVALID_FRAGMENT', 'CAPABILITY_UNAVAILABLE'];
function readOperation(
  options: {
    idempotency?: OperationIdempotency;
    throws?: readonly PreApplyThrowCode[];
    possibleFailureCodes?: readonly ReceiptFailureCode[];
    deterministicTargetResolution?: boolean;
    remediationHints?: readonly string[];
    returnsPromise?: boolean;
  } = {},
): CommandStaticMetadata {
  return {
    mutates: false,
    idempotency: options.idempotency ?? 'idempotent',
    supportsDryRun: false,
    supportsTrackedMode: false,
    possibleFailureCodes: options.possibleFailureCodes ?? NONE_FAILURES,
    throws: {
      preApply: options.throws ?? NONE_THROWS,
      postApplyForbidden: true,
    },
    deterministicTargetResolution: options.deterministicTargetResolution ?? true,
    remediationHints: options.remediationHints,
    returnsPromise: options.returnsPromise,
  };
}
function mutationOperation(options: {
  idempotency: OperationIdempotency;
  supportsDryRun: boolean;
  supportsTrackedMode: boolean;
  supportsConditionalTrackedMode?: boolean;
  possibleFailureCodes: readonly ReceiptFailureCode[];
  throws: readonly PreApplyThrowCode[];
  deterministicTargetResolution?: boolean;
  remediationHints?: readonly string[];
  historyUnsafe?: boolean;
  returnsPromise?: boolean;
  returnsReceipt?: boolean;
}): CommandStaticMetadata {
  return {
    mutates: true,
    idempotency: options.idempotency,
    supportsDryRun: options.supportsDryRun,
    supportsTrackedMode: options.supportsTrackedMode,
    supportsConditionalTrackedMode: options.supportsConditionalTrackedMode,
    possibleFailureCodes: options.possibleFailureCodes,
    throws: {
      preApply: options.throws,
      postApplyForbidden: true,
    },
    deterministicTargetResolution: options.deterministicTargetResolution ?? true,
    remediationHints: options.remediationHints,
    historyUnsafe: options.historyUnsafe,
    returnsPromise: options.returnsPromise,
    returnsReceipt: options.returnsReceipt,
  };
}
// Throw-code shorthand arrays
const T_NOT_FOUND = ['TARGET_NOT_FOUND'] as const;
const T_NOT_FOUND_CAPABLE = ['TARGET_NOT_FOUND', 'CAPABILITY_UNAVAILABLE'] as const;
// Plan-engine throw-code arrays
const T_PLAN_ENGINE = [
  'REVISION_MISMATCH',
  'MATCH_NOT_FOUND',
  'AMBIGUOUS_MATCH',
  'STYLE_CONFLICT',
  'PRECONDITION_FAILED',
  'INVALID_INPUT',
  'CROSS_BLOCK_MATCH',
  'SPAN_FRAGMENTED',
  'TARGET_MOVED',
  'PLAN_CONFLICT_OVERLAP',
  'INVALID_STEP_COMBINATION',
  'REVISION_CHANGED_SINCE_COMPILE',
  'INVALID_INSERTION_CONTEXT',
  'DOCUMENT_IDENTITY_CONFLICT',
  'CAPABILITY_UNAVAILABLE',
] as const;
// Table-command throw-code arrays.
// All mutation operations include CAPABILITY_UNAVAILABLE (contract invariant).
// _TRACKED suffix signals the operation also supports tracked change mode.
const T_NOT_FOUND_COMMAND = ['TARGET_NOT_FOUND', 'INVALID_TARGET', 'CAPABILITY_UNAVAILABLE'] as const;
// Image operations can throw AMBIGUOUS_TARGET when multiple images share an sdImageId.
const T_IMAGE_COMMAND = ['TARGET_NOT_FOUND', 'AMBIGUOUS_TARGET', 'INVALID_TARGET', 'CAPABILITY_UNAVAILABLE'] as const;
// Content controls throw-code families
const T_CC_READ = ['TARGET_NOT_FOUND', 'INVALID_INPUT', 'CAPABILITY_UNAVAILABLE'] as const;
const T_CC_MUTATION = [
  'TARGET_NOT_FOUND',
  'INVALID_TARGET',
  'AMBIGUOUS_TARGET',
  'INVALID_INPUT',
  'LOCK_VIOLATION',
  'REVISION_MISMATCH',
  'CAPABILITY_UNAVAILABLE',
] as const;
const T_CC_TYPED = [...T_CC_MUTATION, 'TYPE_MISMATCH'] as const;
const T_CC_TYPED_READ = [...T_CC_READ, 'TYPE_MISMATCH'] as const;
const T_CC_RAW = ['TARGET_NOT_FOUND', 'INVALID_INPUT', 'REVISION_MISMATCH', 'CAPABILITY_UNAVAILABLE'] as const;
const T_QUERY_MATCH = ['MATCH_NOT_FOUND', 'AMBIGUOUS_MATCH', 'INVALID_INPUT', 'INTERNAL_ERROR'] as const;
const T_SECTION_CREATE = [
  'TARGET_NOT_FOUND',
  'INVALID_TARGET',
  'AMBIGUOUS_TARGET',
  'INVALID_INPUT',
  'CAPABILITY_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;
const T_SECTION_READ = ['TARGET_NOT_FOUND', 'INVALID_TARGET', 'INVALID_INPUT', 'CAPABILITY_UNAVAILABLE'] as const;
const T_PARAGRAPH_MUTATION = ['TARGET_NOT_FOUND', 'INVALID_TARGET', 'CAPABILITY_UNAVAILABLE'] as const;
const T_SECTION_MUTATION = [
  'TARGET_NOT_FOUND',
  'INVALID_TARGET',
  'INVALID_INPUT',
  'CAPABILITY_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;
const T_SECTION_SETTINGS_MUTATION = ['INVALID_INPUT', 'CAPABILITY_UNAVAILABLE', 'INTERNAL_ERROR'] as const;
const T_HEADER_FOOTER_MUTATION = [
  'TARGET_NOT_FOUND',
  'INVALID_TARGET',
  'INVALID_INPUT',
  'CAPABILITY_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;
// Story-scoped throw-code arrays
const T_STORY = [
  'STORY_NOT_FOUND',
  'STORY_MISMATCH',
  'STORY_NOT_SUPPORTED',
  'CROSS_STORY_PLAN',
  'MATERIALIZATION_FAILED',
] as const;
// Reference-namespace throw-code shorthand arrays
const T_REF_READ_LIST = ['CAPABILITY_UNAVAILABLE', 'INVALID_INPUT'] as const;
const T_REF_MUTATION = ['TARGET_NOT_FOUND', 'INVALID_TARGET', 'INVALID_INPUT', 'CAPABILITY_UNAVAILABLE'] as const;
const T_REF_MUTATION_REMOVE = ['TARGET_NOT_FOUND', 'INVALID_TARGET', 'CAPABILITY_UNAVAILABLE'] as const;
const T_REF_INSERT = ['TARGET_NOT_FOUND', 'INVALID_TARGET', 'INVALID_INPUT', 'CAPABILITY_UNAVAILABLE'] as const;
// Protection / permission-range throw-code arrays
const T_PROTECTION_READ = ['CAPABILITY_UNAVAILABLE'] as const;
const T_PROTECTION_MUTATION = ['INVALID_INPUT', 'CAPABILITY_UNAVAILABLE'] as const;
const T_PERM_RANGE_READ = ['TARGET_NOT_FOUND', 'CAPABILITY_UNAVAILABLE'] as const;
const T_PERM_RANGE_MUTATION = [
  'TARGET_NOT_FOUND',
  'INVALID_TARGET',
  'INVALID_INPUT',
  'CAPABILITY_UNAVAILABLE',
] as const;
type FormatInlineAliasOperationId = `format.${InlineRunPatchKey}`;
function camelToKebab(value: string): string {
  return value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}
function formatInlineAliasDescription(key: InlineRunPatchKey): string {
  if (key === 'rtl') {
    return 'Set or clear the `rtl` inline run property on the target text range. This does not change paragraph direction; use `format.paragraph.setDirection` for paragraph-level RTL.';
  }
  return `Set or clear the \`${key}\` inline run property on the target text range.`;
}
function formatInlineAliasExpectedResult(key: InlineRunPatchKey): string {
  if (key === 'rtl') {
    return 'Returns a TextMutationReceipt confirming only the inline run property patch was applied to the target range; paragraph direction is unchanged.';
  }
  return 'Returns a TextMutationReceipt confirming the inline run property patch was applied to the target range.';
}
const FORMAT_INLINE_ALIAS_OPERATION_DEFINITIONS: Record<FormatInlineAliasOperationId, OperationDefinitionEntry> =
  Object.fromEntries(
    INLINE_PROPERTY_REGISTRY.map((entry) => {
      const operationId = `format.${entry.key}` as FormatInlineAliasOperationId;
      const definition: OperationDefinitionEntry = {
        memberPath: operationId,
        description: formatInlineAliasDescription(entry.key),
        expectedResult: formatInlineAliasExpectedResult(entry.key),
        requiresDocumentContext: true,
        metadata: mutationOperation({
          idempotency: 'conditional',
          supportsDryRun: true,
          supportsTrackedMode: entry.tracked,
          possibleFailureCodes: ['INVALID_TARGET'],
          throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET', 'INVALID_INPUT', ...T_STORY],
          returnsReceipt: true,
        }),
        referenceDocPath: `format/${camelToKebab(entry.key)}.mdx`,
        referenceGroup: 'format',
        skipAsATool: true,
      };
      return [operationId, definition];
    }),
  ) as Record<FormatInlineAliasOperationId, OperationDefinitionEntry>;
// ---------------------------------------------------------------------------
// Canonical definitions
// ---------------------------------------------------------------------------
export const OPERATION_DEFINITIONS = {
  get: {
    memberPath: 'get',
    description: 'Read the full document as an SDDocument structure.',
    expectedResult: 'Returns an SDDocument with body content projected into SDM/1 canonical shapes.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
    }),
    referenceDocPath: 'get.mdx',
    referenceGroup: 'core' as ReferenceGroupKey,
  },
  find: {
    memberPath: 'find',
    description:
      'Search the document for text or node matches using SDM/1 selectors. Returns discovery-grade results: for mutation targeting, use query.match instead.',
    expectedResult:
      'Returns an SDFindResult envelope ({ total, limit, offset, items }). Each item is an SDNodeResult ({ node, address }).',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: ['CAPABILITY_UNAVAILABLE', 'INVALID_INPUT', 'ADDRESS_STALE', ...T_STORY],
      deterministicTargetResolution: false,
    }),
    referenceDocPath: 'find.mdx',
    referenceGroup: 'core',
    skipAsATool: true,
  },
  getNode: {
    memberPath: 'getNode',
    description: 'Retrieve a single node by target position.',
    expectedResult: 'Returns an SDNodeResult envelope with the projected SDM/1 node and canonical address.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: [...T_NOT_FOUND, 'ADDRESS_STALE'],
    }),
    referenceDocPath: 'get-node.mdx',
    referenceGroup: 'core',
  },
  getNodeById: {
    memberPath: 'getNodeById',
    description: 'Retrieve a single node by its unique ID.',
    expectedResult: 'Returns an SDNodeResult envelope with the projected SDM/1 node and canonical address.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: T_NOT_FOUND,
    }),
    referenceDocPath: 'get-node-by-id.mdx',
    referenceGroup: 'core',
  },
  getText: {
    memberPath: 'getText',
    description: 'Extract the plain-text content of the document.',
    expectedResult: 'Returns the full plain-text content of the document as a string.',
    requiresDocumentContext: true,
    metadata: readOperation({
      throws: [...T_STORY],
    }),
    referenceDocPath: 'get-text.mdx',
    referenceGroup: 'core',
    intentGroup: 'get_content',
    intentAction: 'text',
  },
  getMarkdown: {
    memberPath: 'getMarkdown',
    description: 'Extract the document content as a Markdown string.',
    expectedResult: 'Returns the full document content as a Markdown-formatted string.',
    requiresDocumentContext: true,
    metadata: readOperation({
      throws: [...T_STORY],
    }),
    referenceDocPath: 'get-markdown.mdx',
    referenceGroup: 'core',
    intentGroup: 'get_content',
    intentAction: 'markdown',
  },
  getHtml: {
    memberPath: 'getHtml',
    description: 'Extract the document content as an HTML string.',
    expectedResult: 'Returns the full document content as an HTML-formatted string.',
    requiresDocumentContext: true,
    metadata: readOperation({
      throws: [...T_STORY],
    }),
    referenceDocPath: 'get-html.mdx',
    referenceGroup: 'core',
    intentGroup: 'get_content',
    intentAction: 'html',
  },
  projectMarkdown: {
    memberPath: 'projectMarkdown',
    description: 'Project document content as Markdown with review, scope, diagnostics, and provenance metadata.',
    expectedResult: 'Returns a Promise resolving to a detailed Markdown content projection result.',
    requiresDocumentContext: true,
    metadata: readOperation({
      throws: ['INVALID_INPUT', 'CAPABILITY_UNAVAILABLE', ...T_STORY],
      returnsPromise: true,
    }),
    referenceDocPath: 'project-markdown.mdx',
    referenceGroup: 'core',
    intentGroup: 'get_content',
    intentAction: 'markdown_projection',
  },
  projectHtml: {
    memberPath: 'projectHtml',
    description: 'Project document content as HTML with review, scope, diagnostics, and provenance metadata.',
    expectedResult: 'Returns a Promise resolving to a detailed HTML content projection result.',
    requiresDocumentContext: true,
    metadata: readOperation({
      throws: ['INVALID_INPUT', 'CAPABILITY_UNAVAILABLE', ...T_STORY],
      returnsPromise: true,
    }),
    referenceDocPath: 'project-html.mdx',
    referenceGroup: 'core',
    intentGroup: 'get_content',
    intentAction: 'html_projection',
  },
  markdownToFragment: {
    memberPath: 'markdownToFragment',
    description: 'Convert a Markdown string into an SDM/1 structural fragment.',
    expectedResult: 'Returns an SDMarkdownToFragmentResult with the converted fragment, lossy flag, and diagnostics.',
    requiresDocumentContext: true,
    metadata: readOperation(),
    referenceDocPath: 'markdown-to-fragment.mdx',
    referenceGroup: 'core',
  },
  htmlToFragment: {
    memberPath: 'htmlToFragment',
    description: 'Convert an HTML string into an SDM/1 structural fragment.',
    expectedResult: 'Returns an SDHtmlToFragmentResult with the converted fragment, lossy flag, and diagnostics.',
    requiresDocumentContext: true,
    metadata: readOperation({ throws: ['CAPABILITY_UNAVAILABLE', 'INVALID_INPUT'] }),
    referenceDocPath: 'html-to-fragment.mdx',
    referenceGroup: 'core',
  },
  info: {
    memberPath: 'info',
    description:
      'Return document summary info including word, character, paragraph, heading, table, image, comment, tracked-change, SDT-field, list, and page counts, plus outline and capabilities.',
    expectedResult:
      'Returns a DocumentInfo object with counts (words, characters, paragraphs, headings, tables, images, comments, trackedChanges, sdtFields, lists, and optionally pages when pagination is active), document outline, capability flags, and revision.',
    requiresDocumentContext: true,
    metadata: readOperation(),
    referenceDocPath: 'info.mdx',
    referenceGroup: 'core',
    intentGroup: 'get_content',
    intentAction: 'info',
  },
  extract: {
    memberPath: 'extract',
    description:
      'Extract all document content with stable IDs for RAG pipelines. Returns blocks with full text, comments, and tracked changes: each with an ID compatible with scrollToElement().',
    expectedResult:
      'Returns an ExtractResult with blocks (nodeId, type, text, headingLevel), comments (entityId, text, anchoredText, blockId, status, author), tracked changes (entityId, type, excerpt, author, date), and revision.',
    requiresDocumentContext: true,
    metadata: readOperation(),
    referenceDocPath: 'extract.mdx',
    referenceGroup: 'core',
    intentGroup: 'get_content',
    intentAction: 'extract',
  },
  clearContent: {
    memberPath: 'clearContent',
    description: 'Clear all document body content, leaving a single empty paragraph.',
    expectedResult: 'Returns a Receipt with success status; reports NO_OP if the document is already empty.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: false,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: ['CAPABILITY_UNAVAILABLE'],
      returnsReceipt: true,
    }),
    referenceDocPath: 'clear-content.mdx',
    referenceGroup: 'core',
  },
  insert: {
    memberPath: 'insert',
    description:
      'Insert content into the document. Two input shapes: ' +
      'text-based (value + type) inserts inline content at a SelectionTarget or ref position within an existing block; ' +
      'structural SDFragment (content) inserts one or more blocks as siblings relative to a BlockNodeAddress target. ' +
      'When target/ref is omitted, content appends at the end of the document. ' +
      'Text mode supports text (default), markdown, and html content types via the `type` field. ' +
      'Rich markdown/html and structural modes use `placement` (before/after/insideStart/insideEnd) to position relative to a block target.',
    expectedResult:
      'Returns an SDMutationReceipt with applied status; resolution reports the resolved insertion point/target. Created visible text and structural blocks are reported through effects.insertedText and effects.insertedBlocks when available. Receipt reports NO_OP if the insertion point is invalid or content is empty.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: [
        'INVALID_TARGET',
        'NO_OP',
        'CAPABILITY_UNAVAILABLE',
        'UNSUPPORTED_ENVIRONMENT',
        'INVALID_NESTING',
        'INVALID_PLACEMENT',
        'INVALID_PAYLOAD',
        'CAPABILITY_UNSUPPORTED',
        'ADDRESS_STALE',
        'DUPLICATE_ID',
        'INVALID_CONTEXT',
        'RAW_MODE_REQUIRED',
        'PRESERVE_ONLY_VIOLATION',
        'INVALID_INPUT',
        'TARGET_NOT_FOUND',
        'PRECONDITION_FAILED',
        'REVISION_MISMATCH',
        'CHECK_MISMATCH',
        'INTERNAL_ERROR',
      ],
      throws: [
        ...T_NOT_FOUND_CAPABLE,
        'INVALID_TARGET',
        'INVALID_INPUT',
        'ADDRESS_STALE',
        'DUPLICATE_ID',
        'RAW_MODE_REQUIRED',
        'PRESERVE_ONLY_VIOLATION',
        'CAPABILITY_UNSUPPORTED',
        ...T_STORY,
      ],
      returnsReceipt: true,
    }),
    referenceDocPath: 'insert.mdx',
    referenceGroup: 'core',
    intentGroup: 'edit',
    intentAction: 'insert',
  },
  replace: {
    memberPath: 'replace',
    description:
      'Replace content at a contiguous document selection. ' +
      'Text path accepts a SelectionTarget or ref plus replacement text. ' +
      'Rich string path accepts HTML or Markdown plus a BlockNodeAddress, SelectionTarget, or ref. ' +
      'Structural path accepts the same locator forms plus SDFragment content. ' +
      "An explicit {kind:'story', storyType:'body'} target replaces the complete main body in direct mode while preserving the destination DOCX package.",
    expectedResult:
      'Returns an SDMutationReceipt with applied status; receipt reports NO_OP if the target range already contains identical content.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: [
        'INVALID_TARGET',
        'NO_OP',
        'INVALID_NESTING',
        'INVALID_PLACEMENT',
        'INVALID_PAYLOAD',
        'CAPABILITY_UNSUPPORTED',
        'ADDRESS_STALE',
        'DUPLICATE_ID',
        'INVALID_CONTEXT',
        'RAW_MODE_REQUIRED',
        'PRESERVE_ONLY_VIOLATION',
        'INVALID_INPUT',
        'TARGET_NOT_FOUND',
        'PRECONDITION_FAILED',
        'REVISION_MISMATCH',
        'CHECK_MISMATCH',
        'INTERNAL_ERROR',
      ],
      throws: [
        ...T_NOT_FOUND_CAPABLE,
        'INVALID_TARGET',
        'INVALID_INPUT',
        'ADDRESS_STALE',
        'DUPLICATE_ID',
        'RAW_MODE_REQUIRED',
        'PRESERVE_ONLY_VIOLATION',
        'CAPABILITY_UNSUPPORTED',
        ...T_STORY,
      ],
      returnsReceipt: true,
    }),
    referenceDocPath: 'replace.mdx',
    referenceGroup: 'core',
    intentGroup: 'edit',
    intentAction: 'replace',
  },
  delete: {
    memberPath: 'delete',
    description:
      'Delete content at a contiguous document selection. Accepts a SelectionTarget or mutation-ready ref. Supports cross-block deletion and optional block-edge expansion via behavior mode.',
    expectedResult:
      'Returns a TextMutationReceipt with applied status; receipt reports NO_OP if the target range is collapsed or empty.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET', 'INVALID_INPUT', ...T_STORY],
      returnsReceipt: true,
    }),
    referenceDocPath: 'delete.mdx',
    referenceGroup: 'core',
    intentGroup: 'edit',
    intentAction: 'delete',
  },
  formatRange: {
    memberPath: 'formatRange',
    description:
      'Legacy root-level alias for inline range formatting. Routes to `format.apply` for compatibility with older callers.',
    expectedResult: 'Returns a TextMutationReceipt confirming inline styles were applied to the target range.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET', 'INVALID_INPUT', ...T_STORY],
      returnsReceipt: true,
    }),
    referenceDocPath: 'format/apply.mdx',
    referenceGroup: 'format',
    skipAsATool: true,
  },
  'blocks.findText': {
    memberPath: 'blocks.findText',
    description:
      'Find top-level body blocks containing a literal case-insensitive substring. Matches flattened block text, coalescing repeated hits and nested table paragraphs into one block. Scans at most 20,000 blocks inside the document host and returns compact previews without transferring full-text pages.',
    expectedResult:
      'Returns matching-block total within the scan, limited matches with zero-based ordinals and 100-character previews, firstMatchOrdinal even for limit:0, scannedBlocks, truncated, and revision. A failed read retains completed pages and reports scanError; revision is unknown if no page succeeded. Whitespace and Unicode are not normalized.',
    requiresDocumentContext: true,
    metadata: readOperation({ throws: ['INVALID_INPUT'] }),
    referenceDocPath: 'blocks/find-text.mdx',
    referenceGroup: 'blocks',
    skipAsATool: true,
  },
  'blocks.list': {
    memberPath: 'blocks.list',
    description:
      'List top-level blocks in document order with IDs, types, text previews, and optional full text when includeText:true. Supports pagination via offset/limit after optional nodeTypes, nodeIds, and literal textSearch filtering, single-story scoping via `in: <StoryLocator>`, and final/original/redline projection of numbering metadata without changing block membership.',
    expectedResult:
      'Returns a BlocksListResult with total block count, an ordered array of block entries, the effective numbering reviewMode, and the current document revision.',
    requiresDocumentContext: true,
    metadata: readOperation({
      throws: ['INVALID_INPUT', ...T_STORY],
    }),
    referenceDocPath: 'blocks/list.mdx',
    referenceGroup: 'blocks',
    intentGroup: 'get_content',
    intentAction: 'blocks',
  },
  'blocks.delete': {
    memberPath: 'blocks.delete',
    description: 'Delete an entire block node (paragraph, heading, list item, table, image, or sdt) deterministically.',
    expectedResult:
      'Returns a BlocksDeleteResult receipt confirming the block was removed, including a deletedBlock summary with ordinal, nodeType, and textPreview.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: NONE_FAILURES,
      throws: [
        'TARGET_NOT_FOUND',
        'AMBIGUOUS_TARGET',
        'CAPABILITY_UNAVAILABLE',
        'INVALID_TARGET',
        'INVALID_INPUT',
        'INTERNAL_ERROR',
        ...T_STORY,
      ],
      returnsReceipt: true,
    }),
    referenceDocPath: 'blocks/delete.mdx',
    referenceGroup: 'blocks',
  },
  'blocks.deleteRange': {
    memberPath: 'blocks.deleteRange',
    description:
      'Delete a contiguous range of top-level blocks between two endpoints (inclusive). Both endpoints must be direct children of the document node. Supports dry-run preview.',
    expectedResult:
      'Returns a BlocksDeleteRangeResult with deletedCount, deletedBlocks array (each with ordinal, nodeId, nodeType, textPreview), before/after revision, and dryRun flag.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: NONE_FAILURES,
      throws: [
        'TARGET_NOT_FOUND',
        'AMBIGUOUS_TARGET',
        'INVALID_TARGET',
        'INVALID_INPUT',
        'CAPABILITY_UNAVAILABLE',
        'INTERNAL_ERROR',
        ...T_STORY,
      ],
    }),
    referenceDocPath: 'blocks/delete-range.mdx',
    referenceGroup: 'blocks',
  },
  'blocks.split': {
    memberPath: 'blocks.split',
    description: v2BackedOnlyDescription(
      'Split a paragraph at a visible-text offset, producing two paragraphs. Preserves unambiguous simple run properties around the cut. Rejects when the paragraph contains fields, content controls, drawings, equations, or unsupported tracked-change wrappers.',
    ),
    expectedResult:
      'Returns a BlocksSplitResult; on success carries the new tail paragraph address, affectedStories, and (for engines that report them) story-absolute textRangeShifts and a txId for history correlation.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: false,
      supportsTrackedMode: true,
      possibleFailureCodes: [
        'INVALID_TARGET',
        'TARGET_NOT_FOUND',
        'CAPABILITY_UNAVAILABLE',
        'INVALID_CONTEXT',
        'INVALID_INPUT',
      ],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET', 'INVALID_INPUT'],
      returnsReceipt: true,
    }),
    referenceDocPath: 'blocks/split.mdx',
    referenceGroup: 'blocks',
  },
  'blocks.merge': {
    memberPath: 'blocks.merge',
    description: v2BackedOnlyDescription(
      'Merge two adjacent paragraphs in the same story. The first paragraph keeps its pPr; the second paragraph is removed. Rejects when either paragraph carries a w:sectPr or when their numbering definitions differ.',
    ),
    expectedResult:
      'Returns a BlocksMergeResult; on success carries the removed paragraph address plus affectedStories, textRangeShifts, and a txId.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: false,
      supportsTrackedMode: true,
      possibleFailureCodes: [
        'INVALID_TARGET',
        'TARGET_NOT_FOUND',
        'CAPABILITY_UNAVAILABLE',
        'INVALID_CONTEXT',
        'INVALID_INPUT',
      ],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET', 'INVALID_INPUT'],
      returnsReceipt: true,
    }),
    referenceDocPath: 'blocks/merge.mdx',
    referenceGroup: 'blocks',
  },
  'blocks.move': {
    memberPath: 'blocks.move',
    description: v2BackedOnlyDescription(
      'Move a paragraph within the same story to a new anchor paragraph (before or after). Cross-story and relationship-bearing moves reject with named reasons. Tracked-mode authoring emits paired `<w:moveFrom>` / `<w:moveTo>` review state with explicit move range marker identity; safe content (no comment/bookmark/permission anchors and no pre-existing tracked wrappers) is required for tracked authoring.',
    ),
    expectedResult:
      'Returns a BlocksMoveResult; on success carries the moved paragraph address plus affectedStories and a txId. Tracked-mode results include `trackedChangeRefs` pointing at the paired move review entity.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: false,
      supportsTrackedMode: true,
      possibleFailureCodes: [
        'INVALID_TARGET',
        'TARGET_NOT_FOUND',
        'CAPABILITY_UNAVAILABLE',
        'INVALID_CONTEXT',
        'INVALID_INPUT',
      ],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET', 'INVALID_INPUT'],
      returnsReceipt: true,
    }),
    referenceDocPath: 'blocks/move.mdx',
    referenceGroup: 'blocks',
  },
  'format.apply': {
    memberPath: 'format.apply',
    description: 'Apply inline run-property patch changes to the target range with explicit set/clear semantics.',
    expectedResult: 'Returns a TextMutationReceipt confirming inline styles were applied to the target range.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET', 'INVALID_INPUT', ...T_STORY],
      returnsReceipt: true,
    }),
    referenceDocPath: 'format/apply.mdx',
    referenceGroup: 'format',
    intentGroup: 'format',
    intentAction: 'inline',
  },
  ...FORMAT_INLINE_ALIAS_OPERATION_DEFINITIONS,
  'styles.apply': {
    memberPath: 'styles.apply',
    description:
      'Apply document-level default style changes to the active Style Definitions part. Targets docDefaults run and paragraph channels with set-style patch semantics.',
    expectedResult: 'Returns a StylesApplyReceipt with per-channel success/failure details for each property change.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: ['INVALID_TARGET', 'INVALID_INPUT', 'CAPABILITY_UNAVAILABLE', 'REVISION_MISMATCH'],
      historyUnsafe: true,
    }),
    referenceDocPath: 'styles/apply.mdx',
    referenceGroup: 'styles',
  },
  'styles.getCatalog': {
    memberPath: 'styles.getCatalog',
    description:
      'List the available styles as a normalized catalogue with stable IDs, display names, type, visibility, priority, provenance, and source diagnostics. Supports view (quickGallery/recommended/currentDocument/all/inUse), type filtering, hidden/latent inclusion, usage rollups, and UI-safe preview tokens. Distinct from DocumentInfo.styles, which is a usage summary.',
    expectedResult:
      'Returns a StylesGetCatalogResult with the requested view, the full filtered style set, document defaults, per-source status, and diagnostics (including labeled fallbacks and unsupported-option notices).',
    requiresDocumentContext: true,
    metadata: readOperation({ idempotency: 'idempotent', throws: ['INVALID_INPUT', 'CAPABILITY_UNAVAILABLE'] }),
    referenceDocPath: 'styles/get-catalog.mdx',
    referenceGroup: 'styles',
  },
  'templates.apply': {
    memberPath: 'templates.apply',
    description:
      'Apply detected DOCX template/substrate (styles, numbering, settings, theme, font table, web settings, headers/footers, section defaults) from a source package onto the current document, preserving body content. Scopes are auto-detected from source package evidence.',
    expectedResult:
      'Returns a TemplatesApplyReceipt with detected/applied/skipped scopes, unsupported items, changed parts, id mappings, and warnings.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      // The adapter bridges runtime engine failures into receipt failures, so
      // possibleFailureCodes must list every code that can appear in a returned
      // { success: false, failure } receipt (see contract.test.ts parity test).
      possibleFailureCodes: [
        'UNSUPPORTED_SOURCE',
        'INVALID_PACKAGE',
        'CAPABILITY_UNAVAILABLE',
        'UNSUPPORTED_TEMPLATE_CONTENT',
      ],
      throws: ['INVALID_INPUT', 'CAPABILITY_UNAVAILABLE', 'REVISION_MISMATCH'],
      historyUnsafe: true,
      // First async Document API operation (SD-3247): the receipt-returning path
      // resolves a Promise (async OPC/ZIP source loading). Pre-apply throws above
      // still fire synchronously. Callers must await editor.doc.templates.apply().
      returnsPromise: true,
    }),
    referenceDocPath: 'templates/apply.mdx',
    referenceGroup: 'templates',
  },
  'create.paragraph': {
    memberPath: 'create.paragraph',
    description: 'Create a standalone paragraph at the target position. To add a list item, use lists.insert instead.',
    expectedResult: 'Returns a CreateParagraphResult with the new paragraph block ID and address.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['INVALID_TARGET'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET', 'AMBIGUOUS_TARGET', ...T_STORY],
    }),
    referenceDocPath: 'create/paragraph.mdx',
    referenceGroup: 'create',
    intentGroup: 'create',
    intentAction: 'paragraph',
  },
  'create.heading': {
    memberPath: 'create.heading',
    description: 'Create a new heading at the target position.',
    expectedResult: 'Returns a CreateHeadingResult with the new heading block ID and address.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['INVALID_TARGET'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET', 'AMBIGUOUS_TARGET', ...T_STORY],
    }),
    referenceDocPath: 'create/heading.mdx',
    referenceGroup: 'create',
    intentGroup: 'create',
    intentAction: 'heading',
  },
  'create.sectionBreak': {
    memberPath: 'create.sectionBreak',
    description: 'Create a section break at the target location with optional initial section properties.',
    expectedResult: 'Returns a CreateSectionBreakResult with the new section break position and section address.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'CAPABILITY_UNAVAILABLE'],
      throws: T_SECTION_CREATE,
    }),
    referenceDocPath: 'create/section-break.mdx',
    referenceGroup: 'create',
  },
  'sections.list': {
    memberPath: 'sections.list',
    description: 'List sections in deterministic order with section-target handles.',
    expectedResult: 'Returns a SectionsListResult with an ordered array of section summaries and their target handles.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: ['INVALID_INPUT', 'CAPABILITY_UNAVAILABLE'],
    }),
    referenceDocPath: 'sections/list.mdx',
    referenceGroup: 'sections',
  },
  'sections.get': {
    memberPath: 'sections.get',
    description: 'Retrieve full section information by section address.',
    expectedResult:
      'Returns a SectionInfo object with full section properties including margins, columns, and header/footer refs.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: T_SECTION_READ,
    }),
    referenceDocPath: 'sections/get.mdx',
    referenceGroup: 'sections',
  },
  'sections.setBreakType': {
    memberPath: 'sections.setBreakType',
    description: 'Set the section break type.',
    expectedResult:
      'Returns a SectionMutationResult receipt; reports NO_OP if the section already has the requested break type.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'CAPABILITY_UNAVAILABLE'],
      throws: T_SECTION_MUTATION,
      historyUnsafe: true,
    }),
    referenceDocPath: 'sections/set-break-type.mdx',
    referenceGroup: 'sections',
  },
  'sections.setPageMargins': {
    memberPath: 'sections.setPageMargins',
    description: 'Set page-edge margins for a section.',
    expectedResult:
      'Returns a SectionMutationResult receipt; reports NO_OP if margins already match the requested values.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'CAPABILITY_UNAVAILABLE'],
      throws: T_SECTION_MUTATION,
      historyUnsafe: true,
    }),
    referenceDocPath: 'sections/set-page-margins.mdx',
    referenceGroup: 'sections',
  },
  'sections.setHeaderFooterMargins': {
    memberPath: 'sections.setHeaderFooterMargins',
    description: 'Set header/footer margin distances for a section.',
    expectedResult:
      'Returns a SectionMutationResult receipt; reports NO_OP if header/footer margins already match the requested values.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'CAPABILITY_UNAVAILABLE'],
      throws: T_SECTION_MUTATION,
      historyUnsafe: true,
    }),
    referenceDocPath: 'sections/set-header-footer-margins.mdx',
    referenceGroup: 'sections',
  },
  'sections.setPageSetup': {
    memberPath: 'sections.setPageSetup',
    description: 'Set page size/orientation properties for a section.',
    expectedResult:
      'Returns a SectionMutationResult receipt; reports NO_OP if page size and orientation already match the requested values.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'CAPABILITY_UNAVAILABLE'],
      throws: T_SECTION_MUTATION,
      historyUnsafe: true,
    }),
    referenceDocPath: 'sections/set-page-setup.mdx',
    referenceGroup: 'sections',
  },
  'sections.setColumns': {
    memberPath: 'sections.setColumns',
    description: 'Set column configuration for a section.',
    expectedResult: 'Returns a SectionMutationResult receipt; reports NO_OP if column configuration already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'CAPABILITY_UNAVAILABLE'],
      throws: T_SECTION_MUTATION,
      historyUnsafe: true,
    }),
    referenceDocPath: 'sections/set-columns.mdx',
    referenceGroup: 'sections',
  },
  'sections.setLineNumbering': {
    memberPath: 'sections.setLineNumbering',
    description: 'Enable or configure line numbering for a section.',
    expectedResult: 'Returns a SectionMutationResult receipt; reports NO_OP if line numbering settings already match.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'CAPABILITY_UNAVAILABLE'],
      throws: T_SECTION_MUTATION,
      historyUnsafe: true,
    }),
    referenceDocPath: 'sections/set-line-numbering.mdx',
    referenceGroup: 'sections',
  },
  'sections.setPageNumbering': {
    memberPath: 'sections.setPageNumbering',
    description: 'Set page numbering format/start and chapter numbering settings for a section.',
    expectedResult: 'Returns a SectionMutationResult receipt; reports NO_OP if page numbering settings already match.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'CAPABILITY_UNAVAILABLE'],
      throws: T_SECTION_MUTATION,
      historyUnsafe: true,
    }),
    referenceDocPath: 'sections/set-page-numbering.mdx',
    referenceGroup: 'sections',
  },
  'sections.setTitlePage': {
    memberPath: 'sections.setTitlePage',
    description: 'Enable or disable title-page behavior for a section.',
    expectedResult: 'Returns a SectionMutationResult receipt; reports NO_OP if the title-page setting already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'CAPABILITY_UNAVAILABLE'],
      throws: T_SECTION_MUTATION,
      historyUnsafe: true,
    }),
    referenceDocPath: 'sections/set-title-page.mdx',
    referenceGroup: 'sections',
  },
  'sections.setOddEvenHeadersFooters': {
    memberPath: 'sections.setOddEvenHeadersFooters',
    description: 'Enable or disable odd/even header-footer mode in document settings.',
    expectedResult:
      'Returns a DocumentMutationResult (not SectionMutationResult) because odd/even headers-footers is a document-level setting, not per-section. Reports NO_OP if the setting already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'CAPABILITY_UNAVAILABLE'],
      throws: T_SECTION_SETTINGS_MUTATION,
      historyUnsafe: true,
    }),
    referenceDocPath: 'sections/set-odd-even-headers-footers.mdx',
    referenceGroup: 'sections',
  },
  'sections.setVerticalAlign': {
    memberPath: 'sections.setVerticalAlign',
    description: 'Set vertical page alignment for a section.',
    expectedResult: 'Returns a SectionMutationResult receipt; reports NO_OP if vertical alignment already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'CAPABILITY_UNAVAILABLE'],
      throws: T_SECTION_MUTATION,
      historyUnsafe: true,
    }),
    referenceDocPath: 'sections/set-vertical-align.mdx',
    referenceGroup: 'sections',
  },
  'sections.setSectionDirection': {
    memberPath: 'sections.setSectionDirection',
    description: 'Set section text flow direction (LTR/RTL).',
    expectedResult: 'Returns a SectionMutationResult receipt; reports NO_OP if text direction already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'CAPABILITY_UNAVAILABLE'],
      throws: T_SECTION_MUTATION,
      historyUnsafe: true,
    }),
    referenceDocPath: 'sections/set-section-direction.mdx',
    referenceGroup: 'sections',
  },
  'sections.setHeaderFooterRef': {
    memberPath: 'sections.setHeaderFooterRef',
    description: 'Set or replace a section header/footer reference for a variant.',
    expectedResult:
      'Returns a SectionMutationResult receipt; reports NO_OP if the header/footer reference already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'CAPABILITY_UNAVAILABLE'],
      throws: T_SECTION_MUTATION,
      historyUnsafe: true,
    }),
    referenceDocPath: 'sections/set-header-footer-ref.mdx',
    referenceGroup: 'sections',
  },
  'sections.clearHeaderFooterRef': {
    memberPath: 'sections.clearHeaderFooterRef',
    description: 'Clear a section header/footer reference for a specific variant.',
    expectedResult:
      'Returns a SectionMutationResult receipt; reports NO_OP if no reference exists for the specified variant.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'CAPABILITY_UNAVAILABLE'],
      throws: T_SECTION_MUTATION,
      historyUnsafe: true,
    }),
    referenceDocPath: 'sections/clear-header-footer-ref.mdx',
    referenceGroup: 'sections',
  },
  'sections.setLinkToPrevious': {
    memberPath: 'sections.setLinkToPrevious',
    description: 'Set or clear link-to-previous behavior for a header/footer variant.',
    expectedResult:
      'Returns a SectionMutationResult receipt; reports NO_OP if link-to-previous already matches the requested value.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'CAPABILITY_UNAVAILABLE'],
      throws: T_SECTION_MUTATION,
      historyUnsafe: true,
    }),
    referenceDocPath: 'sections/set-link-to-previous.mdx',
    referenceGroup: 'sections',
  },
  'sections.setPageBorders': {
    memberPath: 'sections.setPageBorders',
    description: 'Set page border configuration for a section.',
    expectedResult:
      'Returns a SectionMutationResult receipt; reports NO_OP if page border configuration already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'CAPABILITY_UNAVAILABLE'],
      throws: T_SECTION_MUTATION,
      historyUnsafe: true,
    }),
    referenceDocPath: 'sections/set-page-borders.mdx',
    referenceGroup: 'sections',
  },
  'sections.clearPageBorders': {
    memberPath: 'sections.clearPageBorders',
    description: 'Clear page border configuration for a section.',
    expectedResult:
      'Returns a SectionMutationResult receipt; reports NO_OP if no page borders are configured on the section.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'CAPABILITY_UNAVAILABLE'],
      throws: T_SECTION_MUTATION,
      historyUnsafe: true,
    }),
    referenceDocPath: 'sections/clear-page-borders.mdx',
    referenceGroup: 'sections',
  },
  // --- styles.paragraph.* ---
  'styles.paragraph.setStyle': {
    memberPath: 'styles.paragraph.setStyle',
    description:
      'Apply a paragraph style (w:pStyle) to a paragraph-like block, clearing direct run formatting while preserving character-style references.',
    expectedResult:
      'Returns a ParagraphMutationResult; reports NO_OP if the style already matches. When the style changes, direct run formatting is cleared while character-style references are preserved.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP', 'INVALID_INPUT', 'PRECONDITION_FAILED'],
      throws: T_PARAGRAPH_MUTATION,
    }),
    referenceDocPath: 'styles/paragraph/set-style.mdx',
    referenceGroup: 'styles.paragraph',
    intentGroup: 'format',
    intentAction: 'set_style',
  },
  'styles.paragraph.setStyleRef': {
    memberPath: 'styles.paragraph.setStyleRef',
    description: 'Apply a paragraph style (w:pStyle) to a paragraph-like block without clearing direct run formatting.',
    expectedResult:
      'Returns a ParagraphMutationResult; reports NO_OP if the style reference already matches. Unlike setStyle, existing run formatting is preserved.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP', 'INVALID_INPUT', 'PRECONDITION_FAILED'],
      throws: T_PARAGRAPH_MUTATION,
    }),
    referenceDocPath: 'styles/paragraph/set-style-ref.mdx',
    referenceGroup: 'styles.paragraph',
    intentGroup: 'format',
    intentAction: 'set_style_ref',
  },
  'styles.paragraph.clearStyle': {
    memberPath: 'styles.paragraph.clearStyle',
    description: 'Remove the paragraph style reference from a paragraph-like block.',
    expectedResult: 'Returns a ParagraphMutationResult; reports NO_OP if no style is set.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_PARAGRAPH_MUTATION,
    }),
    referenceDocPath: 'styles/paragraph/clear-style.mdx',
    referenceGroup: 'styles.paragraph',
  },
  // --- format.paragraph.* ---
  'format.paragraph.resetDirectFormatting': {
    memberPath: 'format.paragraph.resetDirectFormatting',
    description:
      'Strip all direct paragraph formatting while preserving style reference, numbering, and section metadata.',
    expectedResult: 'Returns a ParagraphMutationResult; reports NO_OP if no direct formatting is present.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_PARAGRAPH_MUTATION,
    }),
    referenceDocPath: 'format/paragraph/reset-direct-formatting.mdx',
    referenceGroup: 'format.paragraph',
  },
  'format.paragraph.setAlignment': {
    memberPath: 'format.paragraph.setAlignment',
    description:
      'Set visual paragraph alignment on a paragraph-like block. For RTL paragraphs, left/right are translated to Word-compatible stored justification values.',
    expectedResult: 'Returns a ParagraphMutationResult; reports NO_OP if the alignment already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_PARAGRAPH_MUTATION,
    }),
    referenceDocPath: 'format/paragraph/set-alignment.mdx',
    referenceGroup: 'format.paragraph',
    intentGroup: 'format',
    intentAction: 'set_alignment',
  },
  'format.paragraph.clearAlignment': {
    memberPath: 'format.paragraph.clearAlignment',
    description: 'Remove direct paragraph alignment, reverting to style-defined or default alignment.',
    expectedResult: 'Returns a ParagraphMutationResult; reports NO_OP if no direct alignment is set.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_PARAGRAPH_MUTATION,
    }),
    referenceDocPath: 'format/paragraph/clear-alignment.mdx',
    referenceGroup: 'format.paragraph',
  },
  'format.paragraph.setIndentation': {
    memberPath: 'format.paragraph.setIndentation',
    description: 'Set paragraph indentation properties (signed left/right, firstLine, hanging) in twips.',
    expectedResult: 'Returns a ParagraphMutationResult; reports NO_OP if indentation already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_PARAGRAPH_MUTATION,
    }),
    referenceDocPath: 'format/paragraph/set-indentation.mdx',
    referenceGroup: 'format.paragraph',
    intentGroup: 'format',
    intentAction: 'set_indentation',
  },
  'format.paragraph.clearIndentation': {
    memberPath: 'format.paragraph.clearIndentation',
    description: 'Remove all direct paragraph indentation.',
    expectedResult: 'Returns a ParagraphMutationResult; reports NO_OP if no direct indentation is set.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_PARAGRAPH_MUTATION,
    }),
    referenceDocPath: 'format/paragraph/clear-indentation.mdx',
    referenceGroup: 'format.paragraph',
  },
  'format.paragraph.setSpacing': {
    memberPath: 'format.paragraph.setSpacing',
    description: 'Set paragraph spacing properties (before, after, line, lineRule) in twips.',
    expectedResult: 'Returns a ParagraphMutationResult; reports NO_OP if spacing already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_PARAGRAPH_MUTATION,
    }),
    referenceDocPath: 'format/paragraph/set-spacing.mdx',
    referenceGroup: 'format.paragraph',
    intentGroup: 'format',
    intentAction: 'set_spacing',
  },
  'format.paragraph.clearSpacing': {
    memberPath: 'format.paragraph.clearSpacing',
    description: 'Remove all direct paragraph spacing.',
    expectedResult: 'Returns a ParagraphMutationResult; reports NO_OP if no direct spacing is set.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_PARAGRAPH_MUTATION,
    }),
    referenceDocPath: 'format/paragraph/clear-spacing.mdx',
    referenceGroup: 'format.paragraph',
  },
  'format.paragraph.setKeepOptions': {
    memberPath: 'format.paragraph.setKeepOptions',
    description: 'Set keep-with-next, keep-lines-together, and widow/orphan control flags.',
    expectedResult: 'Returns a ParagraphMutationResult; reports NO_OP if all flags already match.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_PARAGRAPH_MUTATION,
    }),
    referenceDocPath: 'format/paragraph/set-keep-options.mdx',
    referenceGroup: 'format.paragraph',
  },
  'format.paragraph.setOutlineLevel': {
    memberPath: 'format.paragraph.setOutlineLevel',
    description: 'Set the paragraph outline level (0–9) or null to clear.',
    expectedResult: 'Returns a ParagraphMutationResult; reports NO_OP if outline level already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_PARAGRAPH_MUTATION,
    }),
    referenceDocPath: 'format/paragraph/set-outline-level.mdx',
    referenceGroup: 'format.paragraph',
  },
  'format.paragraph.setFlowOptions': {
    memberPath: 'format.paragraph.setFlowOptions',
    description:
      'Set paragraph flow flags: contextual spacing, page-break-before, suppress-auto-hyphens, and the advanced layout toggles auto-space-DE, auto-space-DN, adjust-right-indent, and snap-to-grid.',
    expectedResult: 'Returns a ParagraphMutationResult; reports NO_OP if all flags already match.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_PARAGRAPH_MUTATION,
    }),
    referenceDocPath: 'format/paragraph/set-flow-options.mdx',
    referenceGroup: 'format.paragraph',
    intentGroup: 'format',
    intentAction: 'set_flow_options',
  },
  'format.paragraph.setTabStop': {
    memberPath: 'format.paragraph.setTabStop',
    description: 'Add or replace a tab stop at a given position.',
    expectedResult: 'Returns a ParagraphMutationResult; reports NO_OP if an identical tab stop already exists.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_PARAGRAPH_MUTATION,
    }),
    referenceDocPath: 'format/paragraph/set-tab-stop.mdx',
    referenceGroup: 'format.paragraph',
  },
  'format.paragraph.clearTabStop': {
    memberPath: 'format.paragraph.clearTabStop',
    description: 'Remove a tab stop at a given position.',
    expectedResult: 'Returns a ParagraphMutationResult; reports NO_OP if no tab stop exists at that position.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_PARAGRAPH_MUTATION,
    }),
    referenceDocPath: 'format/paragraph/clear-tab-stop.mdx',
    referenceGroup: 'format.paragraph',
  },
  'format.paragraph.clearAllTabStops': {
    memberPath: 'format.paragraph.clearAllTabStops',
    description: 'Remove all tab stops from a paragraph.',
    expectedResult: 'Returns a ParagraphMutationResult; reports NO_OP if no tab stops exist.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_PARAGRAPH_MUTATION,
    }),
    referenceDocPath: 'format/paragraph/clear-all-tab-stops.mdx',
    referenceGroup: 'format.paragraph',
  },
  'format.paragraph.setBorder': {
    memberPath: 'format.paragraph.setBorder',
    description: 'Set border properties for a specific side of a paragraph.',
    expectedResult: 'Returns a ParagraphMutationResult; reports NO_OP if the border already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_PARAGRAPH_MUTATION,
    }),
    referenceDocPath: 'format/paragraph/set-border.mdx',
    referenceGroup: 'format.paragraph',
  },
  'format.paragraph.clearBorder': {
    memberPath: 'format.paragraph.clearBorder',
    description: 'Remove border for a specific side or all sides of a paragraph.',
    expectedResult: 'Returns a ParagraphMutationResult; reports NO_OP if the border is already absent.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_PARAGRAPH_MUTATION,
    }),
    referenceDocPath: 'format/paragraph/clear-border.mdx',
    referenceGroup: 'format.paragraph',
  },
  'format.paragraph.setShading': {
    memberPath: 'format.paragraph.setShading',
    description: 'Set paragraph shading (background fill, pattern color, pattern type).',
    expectedResult: 'Returns a ParagraphMutationResult; reports NO_OP if the shading already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_PARAGRAPH_MUTATION,
    }),
    referenceDocPath: 'format/paragraph/set-shading.mdx',
    referenceGroup: 'format.paragraph',
  },
  'format.paragraph.clearShading': {
    memberPath: 'format.paragraph.clearShading',
    description: 'Remove all paragraph shading.',
    expectedResult: 'Returns a ParagraphMutationResult; reports NO_OP if no shading is set.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_PARAGRAPH_MUTATION,
    }),
    referenceDocPath: 'format/paragraph/clear-shading.mdx',
    referenceGroup: 'format.paragraph',
  },
  'format.paragraph.setMarkRunProps': {
    memberPath: 'format.paragraph.setMarkRunProps',
    description: v2BackedOnlyDescription(
      "Set the paragraph mark's run properties (w:pPr/w:rPr), e.g. the font size or specVanish carried by the paragraph-end mark.",
    ),
    expectedResult:
      'Returns a ParagraphMutationResult; reports NO_OP if the encoded mark run properties already match.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'CAPABILITY_UNAVAILABLE'],
      throws: T_PARAGRAPH_MUTATION,
    }),
    referenceDocPath: 'format/paragraph/set-mark-run-props.mdx',
    referenceGroup: 'format.paragraph',
  },
  'format.paragraph.setDirection': {
    memberPath: 'format.paragraph.setDirection',
    description: 'Set paragraph base direction (LTR or RTL via w:bidi). Optionally align text to match.',
    expectedResult: 'Returns a ParagraphMutationResult; reports NO_OP if the direction already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_PARAGRAPH_MUTATION,
    }),
    referenceDocPath: 'format/paragraph/set-direction.mdx',
    referenceGroup: 'format.paragraph',
    intentGroup: 'format',
    intentAction: 'set_direction',
  },
  'format.paragraph.clearDirection': {
    memberPath: 'format.paragraph.clearDirection',
    description: 'Remove explicit paragraph direction, reverting to inherited or default (LTR).',
    expectedResult: 'Returns a ParagraphMutationResult; reports NO_OP if no direction is set.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_PARAGRAPH_MUTATION,
    }),
    referenceDocPath: 'format/paragraph/clear-direction.mdx',
    referenceGroup: 'format.paragraph',
  },
  'format.paragraph.setNumbering': {
    memberPath: 'format.paragraph.setNumbering',
    description:
      'Attach numbering (numId + level) to an existing paragraph or heading so it joins a numbered sequence. Numbering is a paragraph property; the node and its style are otherwise unchanged, though any direct paragraph indent is cleared so the numbering level controls indentation. Direct edits only; tracked mode is unsupported.',
    expectedResult:
      'Returns a ParagraphMutationResult; reports NO_OP if the block already carries this numbering. On a successful apply, resolution.target reflects the post-mutation address (a numbered plain paragraph re-resolves to listItem; a heading stays a heading); a dryRun returns the input target.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_PARAGRAPH_MUTATION,
    }),
    referenceDocPath: 'format/paragraph/set-numbering.mdx',
    referenceGroup: 'format.paragraph',
  },
  'lists.list': {
    memberPath: 'lists.list',
    description: 'List all list nodes in the document, optionally filtered by scope.',
    expectedResult: 'Returns a ListsListResult with an array of list item summaries and total count.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: ['TARGET_NOT_FOUND', 'INVALID_TARGET', 'INVALID_INPUT'],
    }),
    referenceDocPath: 'lists/list.mdx',
    referenceGroup: 'lists',
  },
  'lists.get': {
    memberPath: 'lists.get',
    description: 'Retrieve a specific list node by target.',
    expectedResult: 'Returns a ListItemInfo object with the item kind, level, marker, and address.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: T_NOT_FOUND,
    }),
    referenceDocPath: 'lists/get.mdx',
    referenceGroup: 'lists',
  },
  'lists.insert': {
    memberPath: 'lists.insert',
    description:
      'Insert a new list item before or after an existing list item. The new item inherits the target list context.',
    expectedResult: 'Returns a ListsInsertResult with the new list item address and block ID.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['INVALID_TARGET'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'lists/insert.mdx',
    referenceGroup: 'lists',
    intentGroup: 'list',
    intentAction: 'insert',
  },
  'lists.create': {
    memberPath: 'lists.create',
    description:
      'Create a new list from one or more paragraphs. Supports optional preset or style for new sequences. When sequence.mode is "continuePrevious", preset and style are not allowed: the new items inherit formatting from the previous sequence.',
    expectedResult: 'Returns a ListsCreateResult with the new listId and the first item address.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'LEVEL_OUT_OF_RANGE', 'INVALID_INPUT', 'NO_COMPATIBLE_PREVIOUS'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET', 'INVALID_INPUT'],
    }),
    referenceDocPath: 'lists/create.mdx',
    referenceGroup: 'lists',
    intentGroup: 'list',
    intentAction: 'create',
  },
  'lists.attach': {
    memberPath: 'lists.attach',
    description: 'Convert non-list paragraphs to list items under an existing list sequence.',
    expectedResult:
      'Returns a ListsMutateItemResult confirming attachment. Tracked-mode results include `trackedChangeRefs` pointing at the pPrChange-backed numPr revision.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      // The v2 adapter authors tracked attach via
      // prepareTrackedListDefinitionMutation (pPrChange-backed numPr revision);
      // the catalog flag was lagging the adapter and blocked CLI-transport hosts.
      supportsTrackedMode: true,
      // PRECONDITION_FAILED is reachable in tracked mode:
      // prepareTrackedListDefinitionMutation returns it when no author is
      // configured or the target paragraph carries a conflicting pPrChange.
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP', 'PRECONDITION_FAILED'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'lists/attach.mdx',
    referenceGroup: 'lists',
    intentGroup: 'list',
    intentAction: 'attach',
  },
  'lists.detach': {
    memberPath: 'lists.detach',
    description: 'Remove numbering properties from list items, converting them to plain paragraphs.',
    expectedResult: 'Returns a ListsDetachResult confirming the item was converted to a plain paragraph.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'lists/detach.mdx',
    referenceGroup: 'lists',
    intentGroup: 'list',
    intentAction: 'detach',
  },
  'lists.delete': {
    memberPath: 'lists.delete',
    description:
      "Delete the entire list that contains the targeted list item. Removes ALL items in the same numbered sequence (the contiguous run of list items sharing the target's numbering) AND their text content from the document. " +
      'Pass any single list item from the list as `target`; the op walks adjacent siblings to find the full list. ' +
      'Use this for "remove the list" / "delete this list" intents and for the cleanup step of a list-to-table conversion.',
    expectedResult:
      'Returns a ListsDeleteResult with `deletedCount` (number of items removed). Reports failure (INVALID_TARGET) if the target is not a list item.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'lists/delete.mdx',
    referenceGroup: 'lists',
    intentGroup: 'list',
    intentAction: 'delete',
  },
  'lists.indent': {
    memberPath: 'lists.indent',
    description: 'Increase the indentation level of a list item.',
    expectedResult:
      'Returns a ListsMutateItemResult receipt; reports NO_OP if the item is already at maximum indent level.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'LEVEL_OUT_OF_RANGE'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'lists/indent.mdx',
    referenceGroup: 'lists',
    intentGroup: 'list',
    intentAction: 'indent',
  },
  'lists.outdent': {
    memberPath: 'lists.outdent',
    description: 'Decrease the indentation level of a list item.',
    expectedResult: 'Returns a ListsMutateItemResult receipt; reports NO_OP if the item is already at the root level.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'LEVEL_OUT_OF_RANGE'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'lists/outdent.mdx',
    referenceGroup: 'lists',
    intentGroup: 'list',
    intentAction: 'outdent',
  },
  'lists.join': {
    memberPath: 'lists.join',
    description: 'Merge two adjacent list sequences into one.',
    expectedResult: 'Returns a ListsJoinResult with the resulting listId of the merged sequence.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: [
        'INVALID_TARGET',
        'NO_ADJACENT_SEQUENCE',
        'INCOMPATIBLE_DEFINITIONS',
        'ALREADY_SAME_SEQUENCE',
      ],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'lists/join.mdx',
    referenceGroup: 'lists',
  },
  'lists.canJoin': {
    memberPath: 'lists.canJoin',
    description: 'Check whether two adjacent list sequences can be joined.',
    expectedResult: 'Returns a ListsCanJoinResult indicating feasibility and reason if not possible.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: ['TARGET_NOT_FOUND', 'INVALID_TARGET', 'INVALID_INPUT'],
    }),
    referenceDocPath: 'lists/can-join.mdx',
    referenceGroup: 'lists',
  },
  'lists.separate': {
    memberPath: 'lists.separate',
    description: 'Split a list sequence at the target item, creating a new sequence from that point forward.',
    expectedResult: 'Returns a ListsSeparateResult with the new listId and numId.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'lists/separate.mdx',
    referenceGroup: 'lists',
  },
  'lists.merge': {
    memberPath: 'lists.merge',
    description:
      'Compound: merge two adjacent list sequences into one. Reassigns numId on the absorbed sequence (no strict abstractNumId check: absorbed items adopt the absorbing definition) and deletes empty paragraphs between the two sequences. Use this instead of lists.join for the user-facing "merge these lists" intent.',
    expectedResult: 'Returns a ListsMergeResult with the merged listId, absorbedCount, and removedEmptyBlocks count.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_ADJACENT_SEQUENCE', 'NO_OP'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'lists/merge.mdx',
    referenceGroup: 'lists',
    intentGroup: 'list',
    intentAction: 'merge',
  },
  'lists.split': {
    memberPath: 'lists.split',
    description:
      'Compound: split a list sequence at the target item into two independent sequences. Runs lists.separate then (by default) lists.setValue(1) so the new half starts numbering fresh at 1. Pass restartNumbering:false for raw separate semantics (new half continues the previous count).',
    expectedResult: 'Returns a ListsSplitResult with the new listId, numId, and the restart value applied (or null).',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'lists/split.mdx',
    referenceGroup: 'lists',
    intentGroup: 'list',
    intentAction: 'split',
  },
  'lists.setLevel': {
    memberPath: 'lists.setLevel',
    description: 'Set the absolute nesting level (0..8) of a list item.',
    expectedResult: 'Returns a ListsMutateItemResult receipt; reports NO_OP if already at the target level.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'LEVEL_OUT_OF_RANGE', 'NO_OP'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'lists/set-level.mdx',
    referenceGroup: 'lists',
    intentGroup: 'list',
    intentAction: 'set_level',
  },
  'lists.setValue': {
    memberPath: 'lists.setValue',
    description:
      'Set an explicit numbering value at the target item. Mid-sequence targets are atomically separated first.',
    expectedResult: 'Returns a ListsMutateItemResult receipt.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'lists/set-value.mdx',
    referenceGroup: 'lists',
    intentGroup: 'list',
    intentAction: 'set_value',
  },
  'lists.continuePrevious': {
    memberPath: 'lists.continuePrevious',
    description: 'Continue numbering from the nearest compatible previous list sequence.',
    expectedResult: 'Returns a ListsMutateItemResult receipt.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      returnsReceipt: true,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_COMPATIBLE_PREVIOUS', 'ALREADY_CONTINUOUS'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'lists/continue-previous.mdx',
    referenceGroup: 'lists',
    intentGroup: 'list',
    intentAction: 'continue_previous',
  },
  'lists.canContinuePrevious': {
    memberPath: 'lists.canContinuePrevious',
    description: 'Check whether the target sequence can continue numbering from a previous compatible sequence.',
    expectedResult: 'Returns a ListsCanContinuePreviousResult indicating feasibility.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: ['TARGET_NOT_FOUND', 'INVALID_TARGET', 'INVALID_INPUT'],
    }),
    referenceDocPath: 'lists/can-continue-previous.mdx',
    referenceGroup: 'lists',
  },
  'lists.setLevelRestart': {
    memberPath: 'lists.setLevelRestart',
    description: 'Set the restart behavior for a specific list level.',
    expectedResult: 'Returns a ListsMutateItemResult receipt.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'LEVEL_OUT_OF_RANGE'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'lists/set-level-restart.mdx',
    referenceGroup: 'lists',
  },
  'lists.convertToText': {
    memberPath: 'lists.convertToText',
    description: 'Convert list items to plain paragraphs, optionally prepending the rendered marker text.',
    expectedResult: 'Returns a ListsConvertToTextResult confirming the conversion.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'lists/convert-to-text.mdx',
    referenceGroup: 'lists',
  },
  // SD-1973: List formatting and templates
  'lists.applyTemplate': {
    memberPath: 'lists.applyTemplate',
    description:
      'Advanced alias for lists.applyStyle. Apply a captured ListTemplate to the target list (abstract-scoped, no clone-on-write).',
    expectedResult: 'Returns a ListsMutateItemResult receipt; reports NO_OP if all levels already match.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'LEVEL_OUT_OF_RANGE', 'INVALID_INPUT'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET', 'INVALID_INPUT'],
    }),
    referenceDocPath: 'lists/apply-template.mdx',
    referenceGroup: 'lists',
  },
  'lists.applyPreset': {
    memberPath: 'lists.applyPreset',
    description: 'Apply a built-in list formatting preset to the target list.',
    expectedResult: 'Returns a ListsMutateItemResult receipt; reports NO_OP if all levels already match the preset.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'LEVEL_OUT_OF_RANGE', 'INVALID_INPUT'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET', 'INVALID_INPUT'],
    }),
    referenceDocPath: 'lists/apply-preset.mdx',
    referenceGroup: 'lists',
  },
  'lists.setType': {
    memberPath: 'lists.setType',
    description:
      'Convert a list to ordered or bullet and merge adjacent compatible sequences to preserve continuous numbering.',
    expectedResult:
      'Returns a ListsMutateItemResult receipt; reports NO_OP if the list is already the requested kind and no sequences were merged.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'INVALID_INPUT'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET', 'INVALID_INPUT'],
    }),
    referenceDocPath: 'lists/set-type.mdx',
    referenceGroup: 'lists',
    intentGroup: 'list',
    intentAction: 'set_type',
  },
  'lists.captureTemplate': {
    memberPath: 'lists.captureTemplate',
    description:
      'Advanced alias for lists.getStyle. Capture list formatting from the abstract definition only (does not merge lvlOverride formatting).',
    expectedResult: 'Returns a ListsCaptureTemplateResult containing the captured template.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: ['TARGET_NOT_FOUND', 'INVALID_TARGET', 'INVALID_INPUT'],
      possibleFailureCodes: ['INVALID_TARGET', 'INVALID_INPUT', 'LEVEL_OUT_OF_RANGE'],
    }),
    referenceDocPath: 'lists/capture-template.mdx',
    referenceGroup: 'lists',
  },
  'lists.setLevelNumbering': {
    memberPath: 'lists.setLevelNumbering',
    description:
      'Advanced alias for lists.setLevelNumberStyle/setLevelText/setLevelStart. Set format, pattern, start, and legal numbering in one call (abstract-scoped, no clone-on-write).',
    expectedResult: 'Returns a ListsMutateItemResult receipt; reports NO_OP if the level already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'LEVEL_OUT_OF_RANGE', 'LEVEL_NOT_FOUND'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'lists/set-level-numbering.mdx',
    referenceGroup: 'lists',
  },
  'lists.setLevelBullet': {
    memberPath: 'lists.setLevelBullet',
    description: 'Set the bullet marker text for a specific list level.',
    expectedResult: 'Returns a ListsMutateItemResult receipt; reports NO_OP if the marker already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'LEVEL_OUT_OF_RANGE', 'LEVEL_NOT_FOUND'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'lists/set-level-bullet.mdx',
    referenceGroup: 'lists',
  },
  'lists.setLevelPictureBullet': {
    memberPath: 'lists.setLevelPictureBullet',
    description: 'Set a picture bullet for a specific list level by its OOXML lvlPicBulletId.',
    expectedResult: 'Returns a ListsMutateItemResult receipt; reports NO_OP if the picture bullet already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: [
        'NO_OP',
        'INVALID_TARGET',
        'LEVEL_OUT_OF_RANGE',
        'LEVEL_NOT_FOUND',
        'INVALID_INPUT',
        'CAPABILITY_UNAVAILABLE',
      ],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET', 'CAPABILITY_UNAVAILABLE'],
    }),
    referenceDocPath: 'lists/set-level-picture-bullet.mdx',
    referenceGroup: 'lists',
  },
  'lists.setLevelAlignment': {
    memberPath: 'lists.setLevelAlignment',
    description: 'Set the marker alignment (left, center, right) for a specific list level.',
    expectedResult: 'Returns a ListsMutateItemResult receipt; reports NO_OP if the alignment already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'LEVEL_OUT_OF_RANGE', 'LEVEL_NOT_FOUND'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'lists/set-level-alignment.mdx',
    referenceGroup: 'lists',
  },
  'lists.setLevelIndents': {
    memberPath: 'lists.setLevelIndents',
    description: 'Set the paragraph indentation values (left, hanging, firstLine) for a specific list level.',
    expectedResult: 'Returns a ListsMutateItemResult receipt; reports NO_OP if all indent values already match.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'LEVEL_OUT_OF_RANGE', 'LEVEL_NOT_FOUND', 'INVALID_INPUT'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET', 'INVALID_INPUT'],
    }),
    referenceDocPath: 'lists/set-level-indents.mdx',
    referenceGroup: 'lists',
  },
  'lists.setLevelTrailingCharacter': {
    memberPath: 'lists.setLevelTrailingCharacter',
    description: 'Set the trailing character (tab, space, nothing) after the marker for a specific list level.',
    expectedResult: 'Returns a ListsMutateItemResult receipt; reports NO_OP if the trailing character already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'LEVEL_OUT_OF_RANGE', 'LEVEL_NOT_FOUND'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'lists/set-level-trailing-character.mdx',
    referenceGroup: 'lists',
  },
  'lists.setLevelMarkerFont': {
    memberPath: 'lists.setLevelMarkerFont',
    description: 'Set the font family used for the marker character at a specific list level.',
    expectedResult: 'Returns a ListsMutateItemResult receipt; reports NO_OP if the font already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'LEVEL_OUT_OF_RANGE', 'LEVEL_NOT_FOUND'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'lists/set-level-marker-font.mdx',
    referenceGroup: 'lists',
  },
  'lists.clearLevelOverrides': {
    memberPath: 'lists.clearLevelOverrides',
    description: 'Remove instance-level overrides for a specific list level, restoring abstract definition values.',
    expectedResult: 'Returns a ListsMutateItemResult receipt; reports NO_OP if no override exists.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'LEVEL_OUT_OF_RANGE'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'lists/clear-level-overrides.mdx',
    referenceGroup: 'lists',
  },
  // SD-2025: User-facing list style operations
  'lists.getStyle': {
    memberPath: 'lists.getStyle',
    description:
      'Read the effective reusable style of a list, including instance-level overrides. Returns a ListStyle that can be applied to other lists via lists.applyStyle.',
    expectedResult: 'Returns a ListsGetStyleResult containing the captured style.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: ['TARGET_NOT_FOUND', 'INVALID_TARGET', 'INVALID_INPUT'],
      possibleFailureCodes: ['INVALID_TARGET', 'INVALID_INPUT', 'LEVEL_OUT_OF_RANGE'],
    }),
    referenceDocPath: 'lists/get-style.mdx',
    referenceGroup: 'lists',
  },
  'lists.applyStyle': {
    memberPath: 'lists.applyStyle',
    description:
      'Apply a reusable list style to the target list. Sequence-local: if the abstract definition is shared with other lists, it is cloned first to avoid affecting them.',
    expectedResult: 'Returns a ListsMutateItemResult receipt; reports NO_OP if all levels already match.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'INVALID_INPUT', 'LEVEL_OUT_OF_RANGE'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET', 'INVALID_INPUT'],
    }),
    referenceDocPath: 'lists/apply-style.mdx',
    referenceGroup: 'lists',
  },
  'lists.restartAt': {
    memberPath: 'lists.restartAt',
    description:
      'Restart numbering at the target list item with a specific value. If the item is mid-sequence, it is separated first.',
    expectedResult: 'Returns a ListsMutateItemResult receipt.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'INVALID_INPUT'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET', 'INVALID_INPUT'],
    }),
    referenceDocPath: 'lists/restart-at.mdx',
    referenceGroup: 'lists',
  },
  'lists.setLevelNumberStyle': {
    memberPath: 'lists.setLevelNumberStyle',
    description:
      'Set the numbering style (e.g. decimal, lowerLetter, upperRoman) for a specific list level. Rejects "bullet": use setLevelBullet instead. Sequence-local: clones shared definitions.',
    expectedResult: 'Returns a ListsMutateItemResult receipt; reports NO_OP if the value already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'INVALID_INPUT', 'LEVEL_OUT_OF_RANGE', 'LEVEL_NOT_FOUND'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET', 'INVALID_INPUT'],
    }),
    referenceDocPath: 'lists/set-level-number-style.mdx',
    referenceGroup: 'lists',
  },
  'lists.setLevelText': {
    memberPath: 'lists.setLevelText',
    description:
      'Set the level text pattern (e.g. "%1.", "(%1)") for a specific list level. Uses OOXML level-placeholder syntax. Sequence-local: clones shared definitions.',
    expectedResult: 'Returns a ListsMutateItemResult receipt; reports NO_OP if the value already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'INVALID_INPUT', 'LEVEL_OUT_OF_RANGE', 'LEVEL_NOT_FOUND'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'lists/set-level-text.mdx',
    referenceGroup: 'lists',
  },
  'lists.setLevelStart': {
    memberPath: 'lists.setLevelStart',
    description:
      'Set the start value for a specific list level. Rejects bullet levels and non-positive values. Sequence-local: clones shared definitions.',
    expectedResult: 'Returns a ListsMutateItemResult receipt; reports NO_OP if the value already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'INVALID_INPUT', 'LEVEL_OUT_OF_RANGE', 'LEVEL_NOT_FOUND'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET', 'INVALID_INPUT'],
    }),
    referenceDocPath: 'lists/set-level-start.mdx',
    referenceGroup: 'lists',
  },
  'lists.setLevelLayout': {
    memberPath: 'lists.setLevelLayout',
    description:
      'Set the layout properties (alignment, indentation, trailing character, tab stop) for a specific list level. Accepts partial updates: omitted fields are left unchanged. Sequence-local: clones shared definitions.',
    expectedResult: 'Returns a ListsMutateItemResult receipt; reports NO_OP if all values already match.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'INVALID_INPUT', 'LEVEL_OUT_OF_RANGE', 'LEVEL_NOT_FOUND'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET', 'INVALID_INPUT'],
    }),
    referenceDocPath: 'lists/set-level-layout.mdx',
    referenceGroup: 'lists',
  },
  // v2 numbering-aware list operation surface.
  'lists.getState': {
    memberPath: 'lists.getState',
    description: v2BackedOnlyDescription(
      'Read the numbering-aware list state for a paragraph (numId, ilvl, abstract reference, level format). Returns null when the target is not a list item.',
    ),
    expectedResult:
      'Returns a ListsGetStateResult with `isListItem` plus numId/ilvl/abstract/numFmt metadata when present.',
    requiresDocumentContext: true,
    metadata: readOperation({
      possibleFailureCodes: ['TARGET_NOT_FOUND', 'CAPABILITY_UNAVAILABLE'],
      throws: [...T_NOT_FOUND_CAPABLE],
    }),
    referenceDocPath: 'lists/get-state.mdx',
    referenceGroup: 'lists',
  },
  'lists.apply': {
    memberPath: 'lists.apply',
    description: v2BackedOnlyDescription(
      'Apply a numbering definition to a paragraph. When `/word/numbering.xml` is absent it is materialized atomically together with the package content-type override and document relationship. Seeds bullet or ordered single-level definitions when no `reuseNumId` is provided.',
    ),
    expectedResult:
      'Returns a ListsMutateItemResult receipt with txId; partsChanged includes numbering / content-types / rels when first-list materialization fires.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: false,
      supportsTrackedMode: true,
      possibleFailureCodes: [
        'INVALID_TARGET',
        'TARGET_NOT_FOUND',
        'CAPABILITY_UNAVAILABLE',
        'INVALID_CONTEXT',
        'INVALID_INPUT',
      ],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET', 'INVALID_INPUT'],
    }),
    referenceDocPath: 'lists/apply.mdx',
    referenceGroup: 'lists',
  },
  'lists.continue': {
    memberPath: 'lists.continue',
    description: v2BackedOnlyDescription(
      "Continue from the previous compatible list item in the same story. Adopts the previous paragraph's numId+ilvl. Rejects with named reasons when no compatible previous item exists or when an intervening structural boundary blocks the continuation.",
    ),
    expectedResult: 'Returns a ListsMutateItemResult receipt with txId.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: false,
      supportsTrackedMode: true,
      possibleFailureCodes: ['INVALID_TARGET', 'TARGET_NOT_FOUND', 'CAPABILITY_UNAVAILABLE', 'INVALID_CONTEXT'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'lists/continue.mdx',
    referenceGroup: 'lists',
  },
  'lists.restart': {
    memberPath: 'lists.restart',
    description: v2BackedOnlyDescription(
      'Restart numbering at a list item. Creates a new `<w:num>` that references the existing `<w:abstractNumId>` with a `<w:lvlOverride><w:startOverride/></w:lvlOverride>`. Distant paragraphs sharing the old numId are intentionally untouched.',
    ),
    expectedResult: 'Returns a ListsMutateItemResult receipt with txId; partsChanged includes /word/numbering.xml.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: false,
      supportsTrackedMode: true,
      possibleFailureCodes: [
        'INVALID_TARGET',
        'TARGET_NOT_FOUND',
        'CAPABILITY_UNAVAILABLE',
        'INVALID_CONTEXT',
        'INVALID_INPUT',
      ],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET', 'INVALID_INPUT'],
    }),
    referenceDocPath: 'lists/restart.mdx',
    referenceGroup: 'lists',
  },
  'lists.remove': {
    memberPath: 'lists.remove',
    description: v2BackedOnlyDescription(
      'Strip the `<w:numPr>` from a list-item paragraph. The numbering definition in `/word/numbering.xml` is intentionally NOT modified; orphan cleanup is handled by the export-side stripper.',
    ),
    expectedResult: 'Returns a ListsMutateItemResult receipt with txId.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: false,
      supportsTrackedMode: true,
      possibleFailureCodes: ['INVALID_TARGET', 'TARGET_NOT_FOUND', 'CAPABILITY_UNAVAILABLE', 'INVALID_CONTEXT'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'lists/remove.mdx',
    referenceGroup: 'lists',
  },
  'comments.create': {
    memberPath: 'comments.create',
    description:
      'Create a new comment thread (or reply when parentCommentId is given). Accepts TextAddress / TextTarget anchors, or a TrackedChangeCommentTarget that names a logical tracked-change id. The tracked-change target accepts both the explicit kind form and the Labs-compatible trackedChangeId-only form; the adapter normalizes it to a Word-compatible content anchor on the requested revision side. Callers may supply a durable externalId, or use the v1-compatible caller-supplied commentId alias, plus author fields and arbitrary JSON metadata for integration correlation. The caller-owned id remains distinct from the generated Word-compatible commentId.',
    expectedResult:
      'Returns a Receipt with the new commentId in `id` and `inserted` on success; rejects whitespace-only bodies, unsupported anchor contexts, and cross-story targets. Tracked-change comment targets support insertion, deletion, replacement, and paired-move revisions; they fail with `TARGET_NOT_FOUND` for stale ids, `CAPABILITY_UNAVAILABLE` for formatting / structural revisions and unpaired move sides, and `INVALID_TARGET` for incompatible side requests or ambiguous replacement targets that omit a required `side`.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: false,
      supportsTrackedMode: false,
      possibleFailureCodes: [
        'INVALID_INPUT',
        'INVALID_TARGET',
        'INVALID_CONTEXT',
        'TARGET_NOT_FOUND',
        'CAPABILITY_UNAVAILABLE',
      ],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET', 'INVALID_INPUT'],
      returnsReceipt: true,
    }),
    referenceDocPath: 'comments/create.mdx',
    referenceGroup: 'comments',
    intentGroup: 'comment',
    intentAction: 'create',
  },
  'comments.patch': {
    memberPath: 'comments.patch',
    description:
      'Patch exactly one field on an existing comment (`text`, `target`, `status`, or `isInternal`). The `target` branch accepts a plain TextAddress or a TrackedChangeCommentTarget, with or without `kind: "trackedChange"`, that names a logical tracked-change id. The legacy `isInternal` input sets or clears the `sdcom:internal` attribute for v1 backward compatibility. Multi-field patches and no-op edits are rejected with `INVALID_INPUT`; reply target / status patches are rejected with `INVALID_CONTEXT`.',
    expectedResult:
      'Returns a Receipt with `updated` populated on success. Reports `NO_OP` for byte-identical edits, rejects empty-body / trim-equivalent edits with `INVALID_INPUT`, no-op resolve/reopen/setInternal with `INVALID_INPUT`, reply target/status with `INVALID_CONTEXT`, cross-story moves with `INVALID_CONTEXT`, materializing inherited slot moves with `CAPABILITY_UNAVAILABLE`, stale tracked-change targets with `TARGET_NOT_FOUND`, and formatting / structural / unpaired-move tracked-change targets with `CAPABILITY_UNAVAILABLE`.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: false,
      supportsTrackedMode: false,
      possibleFailureCodes: [
        'INVALID_INPUT',
        'INVALID_TARGET',
        'INVALID_CONTEXT',
        'TARGET_NOT_FOUND',
        'CAPABILITY_UNAVAILABLE',
        'NO_OP',
      ],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET', 'INVALID_INPUT'],
      returnsReceipt: true,
    }),
    referenceDocPath: 'comments/patch.mdx',
    referenceGroup: 'comments',
    intentGroup: 'comment',
    intentAction: 'update',
  },
  'comments.delete': {
    memberPath: 'comments.delete',
    description: 'Remove the targeted comment or reply by ID. Deleting a root does not delete descendant replies.',
    expectedResult:
      'Returns a Receipt with the targeted removed commentId in `removed` and every story touched in `affectedStories`. Rejects with `TARGET_NOT_FOUND` when the comment id does not exist and reports `NO_OP` when the command layer accepts the target but removes nothing.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: false,
      supportsTrackedMode: false,
      possibleFailureCodes: ['TARGET_NOT_FOUND', 'CAPABILITY_UNAVAILABLE', 'NO_OP'],
      throws: T_NOT_FOUND_CAPABLE,
      returnsReceipt: true,
    }),
    referenceDocPath: 'comments/delete.mdx',
    referenceGroup: 'comments',
    intentGroup: 'comment',
    intentAction: 'delete',
  },
  'comments.get': {
    memberPath: 'comments.get',
    description: 'Retrieve a single comment thread by ID.',
    expectedResult: 'Returns a CommentInfo object with the comment text, author, date, and thread metadata.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: T_NOT_FOUND,
    }),
    referenceDocPath: 'comments/get.mdx',
    referenceGroup: 'comments',
    intentGroup: 'comment',
    intentAction: 'get',
  },
  'comments.list': {
    memberPath: 'comments.list',
    description: 'List all comment threads in the document.',
    expectedResult: 'Returns a CommentsListResult with an array of comment threads and total count.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: ['INVALID_INPUT'],
    }),
    referenceDocPath: 'comments/list.mdx',
    referenceGroup: 'comments',
    intentGroup: 'comment',
    intentAction: 'list',
  },
  'trackChanges.list': {
    memberPath: 'trackChanges.list',
    description:
      'List tracked changes in the document. Body-only by default; pass `in: <StoryLocator>` or `in: "all"` to widen scope.',
    expectedResult:
      'Returns a TrackChangesListResult of logical tracked-change entries with SuperDoc ids, semantic type/subtype, author/date/excerpt, revisionGroupId, flat projection fields (`grouping`, `insertedText`, `deletedText`, `formattingDeltaSummary`, `origin`, `imported`, `canonicalizationKind`, `addressKind`, `resolvableById`), optional overlap metadata, and source provenance via `sourceIds` / `wordRevisionIds`. Structural whole-table changes surface subtypes such as `table-insert` and `table-delete`.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: ['INVALID_INPUT'],
    }),
    referenceDocPath: 'track-changes/list.mdx',
    referenceGroup: 'trackChanges',
    intentGroup: 'track_changes',
    intentAction: 'list',
  },
  'trackChanges.get': {
    memberPath: 'trackChanges.get',
    description: 'Retrieve a single tracked change by SuperDoc logical id.',
    expectedResult:
      'Returns a TrackChangeInfo object with the logical id, semantic type/subtype, state, target, before/after snapshots, author/initials/email, date, revisionGroupId, splitFromId, replacement or move side metadata when applicable, story locator, excerpt, optional overlap metadata, and source provenance via `sourceIds` / `wordRevisionIds`. Structural whole-table changes surface subtypes such as `table-insert` and `table-delete`.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: T_NOT_FOUND,
    }),
    referenceDocPath: 'track-changes/get.mdx',
    referenceGroup: 'trackChanges',
  },
  'trackChanges.decide': {
    memberPath: 'trackChanges.decide',
    description:
      'Accept or reject tracked changes by logical id, by several logical ids atomically, by selected text range, by logical anchor range ({ anchor, relativeStart, relativeEnd }), or every active change in the document. Range targets may include overlap / side selectors and may partially resolve a change, splitting surviving content into new fragments with stable ids. Legacy `{ id, range: { kind: "partial", ... } }` targets are promoted only when the active adapter supports `decide()`; legacy fallback adapters fail closed with `INVALID_INPUT`. `input.expectedRevision` is accepted as a compatibility alias for mutation options.',
    expectedResult:
      "Returns a Receipt. `removed` lists retired tracked-change ids; `inserted` lists successor fragment ids produced by partial range splits; `invalidatedRefs` lists every retired tracked-change ref plus cascade-deleted comment ids; `remappedRefs` carries surviving comment anchors moved by the decision; `affectedStories` lists touched stories; `textRangeShifts` reports per-story visible-text deltas; `txId` correlates with history. Failures: SPAN_FRAGMENTED when a range crosses an indivisible boundary, CAPABILITY_UNAVAILABLE for formatting / structural / move targets (not yet supported), TARGET_NOT_FOUND for retired ids or zero overlap, STALE_REVISION for stale expectedRevision, REVISION_MISMATCH for stale range coverage, NO_OP when { kind: 'all' } resolves an empty target set.",
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: false,
      supportsTrackedMode: false,
      possibleFailureCodes: [
        'NO_OP',
        'INVALID_INPUT',
        'INVALID_TARGET',
        'TARGET_NOT_FOUND',
        'CAPABILITY_UNAVAILABLE',
        'PERMISSION_DENIED',
        'PRECONDITION_FAILED',
        'COMMENT_CASCADE_PARTIAL',
        'SPAN_FRAGMENTED',
        'STALE_REVISION',
        'REVISION_MISMATCH',
      ],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_INPUT', 'INVALID_TARGET'],
      returnsReceipt: true,
    }),
    referenceDocPath: 'track-changes/decide.mdx',
    referenceGroup: 'trackChanges',
    intentGroup: 'track_changes',
    intentAction: 'decide',
  },
  'query.match': {
    memberPath: 'query.match',
    description:
      'Deterministic selector-based search returning mutation-grade addresses and text ranges. Use this to discover targets before any mutation.',
    expectedResult: 'Returns a QueryMatchOutput with the resolved target address and cardinality metadata.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: [...T_QUERY_MATCH, ...T_STORY],
      deterministicTargetResolution: true,
    }),
    referenceDocPath: 'query/match.mdx',
    referenceGroup: 'query',
    intentGroup: 'search',
    intentAction: 'match',
  },
  'ranges.resolve': {
    memberPath: 'ranges.resolve',
    description:
      'Resolve two explicit anchors into a contiguous document range. Returns a transparent SelectionTarget, handle metadata, and preview metadata. handle.ref is nullable and present only when the resolved range is mutation-ready; callers must check handle.ref !== null and/or coversFullTarget before using it for mutations. Stateless and deterministic.',
    expectedResult:
      'Returns a ResolveRangeOutput with evaluatedRevision, handle.ref may be null, handle.coversFullTarget, target (SelectionTarget), and preview metadata.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: [
        'INVALID_INPUT',
        'INVALID_TARGET',
        'TARGET_NOT_FOUND',
        'INVALID_CONTEXT',
        'REVISION_MISMATCH',
        'AMBIGUOUS_MATCH',
        'ADDRESS_STALE',
        'STORY_MISMATCH',
      ],
      deterministicTargetResolution: true,
    }),
    referenceDocPath: 'ranges/resolve.mdx',
    referenceGroup: 'ranges',
  },
  'selection.current': {
    memberPath: 'selection.current',
    description:
      "Read the editor's current selection as a portable SelectionInfo with a text-anchored TextTarget. Primitive for building custom comments UIs, floating toolbars, and other selection-driven components without reaching into ProseMirror internals.",
    expectedResult:
      'Returns a SelectionInfo with `empty`, `target` (TextTarget or null), optional `selectionTarget`, `activeMarks`, and optionally `text` when `includeText: true`.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: ['INVALID_INPUT', 'INVALID_CONTEXT'],
      deterministicTargetResolution: true,
    }),
    referenceDocPath: 'selection/current.mdx',
    referenceGroup: 'selection',
  },
  'mutations.preview': {
    memberPath: 'mutations.preview',
    description: 'Dry-run a mutation plan, returning resolved targets without applying changes.',
    expectedResult: 'Returns a MutationsPreviewOutput with resolved targets and step details without applying changes.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: [...T_PLAN_ENGINE, ...T_STORY],
      deterministicTargetResolution: true,
    }),
    referenceDocPath: 'mutations/preview.mdx',
    referenceGroup: 'mutations',
    intentGroup: 'mutations',
    intentAction: 'preview',
  },
  'mutations.apply': {
    memberPath: 'mutations.apply',
    description: 'Execute a mutation plan atomically against the document.',
    expectedResult: 'Returns a PlanReceipt with per-step results for the atomically applied mutation plan.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: false,
      supportsTrackedMode: true,
      possibleFailureCodes: ['INVALID_CONTEXT'],
      throws: [
        ...T_PLAN_ENGINE,
        'DUPLICATE_ID',
        'RAW_MODE_REQUIRED',
        'PRESERVE_ONLY_VIOLATION',
        'CAPABILITY_UNSUPPORTED',
        ...T_STORY,
      ],
      deterministicTargetResolution: true,
    }),
    referenceDocPath: 'mutations/apply.mdx',
    referenceGroup: 'mutations',
    intentGroup: 'mutations',
    intentAction: 'apply',
  },
  'plan.execute': {
    memberPath: 'plan.execute',
    description:
      'Execute a compiled batch of plan-safe operation entries with per-entry transactions, ' +
      'capture resolution between entries, and keep-prefix-and-continue failure semantics.',
    expectedResult:
      'Returns a PlanExecuteResult with per-entry receipts, projected captures, and the first hard failure if any.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: false,
      supportsTrackedMode: false,
      possibleFailureCodes: [],
      throws: ['INVALID_INPUT', 'CAPABILITY_UNAVAILABLE'],
      deterministicTargetResolution: true,
    }),
    referenceDocPath: 'mutations/plan-execute.mdx',
    referenceGroup: 'mutations',
    skipAsATool: true,
  },
  'capabilities.get': {
    memberPath: 'capabilities',
    description: 'Query runtime capabilities supported by the current document engine.',
    expectedResult: 'Returns a DocumentApiCapabilities object describing supported features of the current engine.',
    requiresDocumentContext: false,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: NONE_THROWS,
    }),
    referenceDocPath: 'capabilities/get.mdx',
    referenceGroup: 'capabilities',
  },
  'capabilities.check': {
    memberPath: 'capabilities.check',
    description:
      'Check an exact HTML or Markdown insert, replace, or detailed projection against the current document without mutating it.',
    expectedResult:
      'Returns a Promise resolving to structured support, fidelity outcome, diagnostics, and a revision-bound guard for supported writes.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'conditional',
      throws: ['INVALID_INPUT', 'CAPABILITY_UNAVAILABLE'],
      returnsPromise: true,
    }),
    referenceDocPath: 'capabilities/check.mdx',
    referenceGroup: 'capabilities',
    intentGroup: 'edit',
    intentAction: 'check_support',
  },
  // -------------------------------------------------------------------------
  // Create: table
  // -------------------------------------------------------------------------
  'create.table': {
    memberPath: 'create.table',
    description: 'Create a new table at the target position.',
    expectedResult: 'Returns a CreateTableResult with the new table block ID and address.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['INVALID_TARGET'],
      throws: [...T_NOT_FOUND_COMMAND, 'INVALID_TARGET', 'AMBIGUOUS_TARGET'],
    }),
    referenceDocPath: 'create/table.mdx',
    referenceGroup: 'create',
    intentGroup: 'create',
    intentAction: 'table',
  },
  // -------------------------------------------------------------------------
  // Tables: lifecycle
  // -------------------------------------------------------------------------
  'tables.convertFromText': {
    memberPath: 'tables.convertFromText',
    description: 'Convert a text range into a table.',
    expectedResult: 'Returns a TableMutationResult receipt confirming text was converted into a table.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/convert-from-text.mdx',
    referenceGroup: 'tables',
  },
  'tables.delete': {
    memberPath: 'tables.delete',
    description: 'Delete the target table from the document.',
    expectedResult: 'Returns a TableMutationResult receipt; reports NO_OP if the table was already removed.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: [...T_NOT_FOUND_COMMAND, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'tables/delete.mdx',
    referenceGroup: 'tables',
    intentGroup: 'table',
    intentAction: 'delete',
  },
  'tables.clearContents': {
    memberPath: 'tables.clearContents',
    description: 'Clear the contents of the target table or cell range.',
    expectedResult: 'Returns a TableMutationResult receipt; reports NO_OP if the target cells are already empty.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/clear-contents.mdx',
    referenceGroup: 'tables',
  },
  'tables.move': {
    memberPath: 'tables.move',
    description: 'Move a table to a new position in the document.',
    expectedResult:
      'Returns a TableMutationResult receipt; reports NO_OP if the table is already at the target position.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/move.mdx',
    referenceGroup: 'tables',
  },
  'tables.split': {
    memberPath: 'tables.split',
    description: 'Split a table into two tables at the target row.',
    expectedResult: 'Returns a TableMutationResult receipt confirming the table was split at the target row.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/split.mdx',
    referenceGroup: 'tables',
  },
  'tables.convertToText': {
    memberPath: 'tables.convertToText',
    description: 'Convert a table back to plain text.',
    expectedResult: 'Returns a TableMutationResult receipt; reports NO_OP if the table has no content to convert.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/convert-to-text.mdx',
    referenceGroup: 'tables',
  },
  // -------------------------------------------------------------------------
  // Tables: layout
  // -------------------------------------------------------------------------
  'tables.setLayout': {
    memberPath: 'tables.setLayout',
    description: 'Set the layout mode of the target table.',
    expectedResult:
      'Returns a TableMutationResult receipt; reports NO_OP if the table already uses the requested layout mode.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/set-layout.mdx',
    referenceGroup: 'tables',
    intentGroup: 'table',
    intentAction: 'set_layout',
  },
  // -------------------------------------------------------------------------
  // Tables: row structure
  // -------------------------------------------------------------------------
  'tables.insertRow': {
    memberPath: 'tables.insertRow',
    description:
      'Insert a new row into the target table. The new row is cloned from an adjacent row, so it inherits the existing cell shading, borders, alignment, and padding. No follow-up styling call is needed unless the new row should look different from the rest of the table.',
    expectedResult: 'Returns a TableMutationResult receipt confirming a row was inserted.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['INVALID_TARGET'],
      throws: [...T_NOT_FOUND_COMMAND, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'tables/insert-row.mdx',
    referenceGroup: 'tables',
    intentGroup: 'table',
    intentAction: 'insert_row',
  },
  'tables.deleteRow': {
    memberPath: 'tables.deleteRow',
    description: 'Delete a row from the target table.',
    expectedResult: 'Returns a TableMutationResult receipt; reports NO_OP if the target row does not exist.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: [...T_NOT_FOUND_COMMAND, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'tables/delete-row.mdx',
    referenceGroup: 'tables',
    intentGroup: 'table',
    intentAction: 'delete_row',
  },
  'tables.moveRow': {
    memberPath: 'tables.moveRow',
    description: v2BackedOnlyDescription('Move a row to a new position within the same table.'),
    expectedResult:
      'Returns a TableMutationResult receipt; reports NO_OP if the row is already at the requested position.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP', 'CAPABILITY_UNAVAILABLE'],
      throws: [...T_NOT_FOUND_COMMAND, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'tables/move-row.mdx',
    referenceGroup: 'tables',
    intentGroup: 'table',
    intentAction: 'move_row',
  },
  'tables.setRowHeight': {
    memberPath: 'tables.setRowHeight',
    description: 'Set the height of a table row.',
    expectedResult: 'Returns a TableMutationResult receipt; reports NO_OP if the row height already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/set-row-height.mdx',
    referenceGroup: 'tables',
    intentGroup: 'table',
    intentAction: 'set_row',
  },
  'tables.distributeRows': {
    memberPath: 'tables.distributeRows',
    description: 'Distribute row heights evenly across the target table.',
    expectedResult: 'Returns a TableMutationResult receipt; reports NO_OP if row heights are already equal.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/distribute-rows.mdx',
    referenceGroup: 'tables',
  },
  'tables.setRowOptions': {
    memberPath: 'tables.setRowOptions',
    description: 'Set options on a table row such as header repeat or page break.',
    expectedResult: 'Returns a TableMutationResult receipt; reports NO_OP if row options already match.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/set-row-options.mdx',
    referenceGroup: 'tables',
    intentGroup: 'table',
    intentAction: 'set_row_options',
  },
  // -------------------------------------------------------------------------
  // Tables: column structure
  // -------------------------------------------------------------------------
  'tables.insertColumn': {
    memberPath: 'tables.insertColumn',
    description:
      'Insert a new column into the target table. The new column is cloned from an adjacent column, so it inherits the existing cell shading, borders, alignment, and width. No follow-up styling call is needed unless the new column should look different from the rest of the table.',
    expectedResult: 'Returns a TableMutationResult receipt confirming a column was inserted.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['INVALID_TARGET'],
      throws: [...T_NOT_FOUND_COMMAND, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'tables/insert-column.mdx',
    referenceGroup: 'tables',
    intentGroup: 'table',
    intentAction: 'insert_column',
  },
  'tables.deleteColumn': {
    memberPath: 'tables.deleteColumn',
    description: 'Delete a column from the target table.',
    expectedResult: 'Returns a TableMutationResult receipt; reports NO_OP if the target column does not exist.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: [...T_NOT_FOUND_COMMAND, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'tables/delete-column.mdx',
    referenceGroup: 'tables',
    intentGroup: 'table',
    intentAction: 'delete_column',
  },
  'tables.moveColumn': {
    memberPath: 'tables.moveColumn',
    description: v2BackedOnlyDescription(
      'Move a column to a new position within the same table. Direct mode only; tables with vertical merges, nested tables, or irregular column coverage are rejected, and tracked (suggesting) mode is not supported yet.',
    ),
    expectedResult:
      'Returns a TableMutationResult receipt; reports NO_OP if the column is already at the requested position.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: [
        'TARGET_NOT_FOUND',
        'INVALID_TARGET',
        'NO_OP',
        'CAPABILITY_UNAVAILABLE',
        'INVALID_CONTEXT',
      ],
      throws: [...T_NOT_FOUND_COMMAND, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'tables/move-column.mdx',
    referenceGroup: 'tables',
    intentGroup: 'table',
    intentAction: 'move_column',
  },
  'tables.setColumnWidth': {
    memberPath: 'tables.setColumnWidth',
    description: 'Set the width of a table column.',
    expectedResult: 'Returns a TableMutationResult receipt; reports NO_OP if the column width already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/set-column-width.mdx',
    referenceGroup: 'tables',
    intentGroup: 'table',
    intentAction: 'set_column',
  },
  'tables.distributeColumns': {
    memberPath: 'tables.distributeColumns',
    description: 'Distribute column widths evenly across the target table.',
    expectedResult: 'Returns a TableMutationResult receipt; reports NO_OP if column widths are already equal.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/distribute-columns.mdx',
    referenceGroup: 'tables',
  },
  // -------------------------------------------------------------------------
  // Tables: cell structure
  // -------------------------------------------------------------------------
  'tables.insertCell': {
    memberPath: 'tables.insertCell',
    description: 'Insert a new cell into a table row.',
    expectedResult: 'Returns a TableMutationResult receipt confirming a cell was inserted.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET'],
      throws: [...T_NOT_FOUND_COMMAND, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'tables/insert-cell.mdx',
    referenceGroup: 'tables',
  },
  'tables.deleteCell': {
    memberPath: 'tables.deleteCell',
    description: 'Delete a cell from a table row.',
    expectedResult: 'Returns a TableMutationResult receipt; reports NO_OP if the target cell does not exist.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: [...T_NOT_FOUND_COMMAND, 'INVALID_TARGET'],
    }),
    referenceDocPath: 'tables/delete-cell.mdx',
    referenceGroup: 'tables',
  },
  'tables.mergeCells': {
    memberPath: 'tables.mergeCells',
    description: 'Merge a range of table cells into one.',
    expectedResult: 'Returns a TableMutationResult receipt; reports NO_OP if the cells are already merged.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP', 'INVALID_CONTEXT'],
      throws: [...T_NOT_FOUND_COMMAND, 'INVALID_CONTEXT'],
    }),
    referenceDocPath: 'tables/merge-cells.mdx',
    referenceGroup: 'tables',
    intentGroup: 'table',
    intentAction: 'merge_cells',
  },
  'tables.unmergeCells': {
    memberPath: 'tables.unmergeCells',
    description: 'Unmerge a previously merged table cell.',
    expectedResult: 'Returns a TableMutationResult receipt; reports NO_OP if the cell is not merged.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP', 'INVALID_CONTEXT'],
      throws: [...T_NOT_FOUND_COMMAND, 'INVALID_CONTEXT'],
    }),
    referenceDocPath: 'tables/unmerge-cells.mdx',
    referenceGroup: 'tables',
    intentGroup: 'table',
    intentAction: 'unmerge_cells',
  },
  'tables.splitCell': {
    memberPath: 'tables.splitCell',
    description: 'Split a table cell into multiple cells.',
    expectedResult: 'Returns a TableMutationResult receipt confirming the cell was split.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'INVALID_CONTEXT'],
      throws: [...T_NOT_FOUND_COMMAND, 'INVALID_CONTEXT'],
    }),
    referenceDocPath: 'tables/split-cell.mdx',
    referenceGroup: 'tables',
  },
  'tables.setCellProperties': {
    memberPath: 'tables.setCellProperties',
    description:
      'Set non-text properties on a single table cell: vertical alignment, text wrapping, fit-text, or preferred width. ' +
      'Requires a cell-level target (a tableCell block address with kind, nodeType, nodeId). Does NOT accept a table target with rowIndex/columnIndex. ' +
      'To set the text content of a cell, use action "set_cell_text" instead.',
    expectedResult: 'Returns a TableMutationResult receipt; reports NO_OP if cell properties already match.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/set-cell-properties.mdx',
    referenceGroup: 'tables',
    intentGroup: 'table',
    intentAction: 'set_cell',
  },
  'tables.setCellText': {
    memberPath: 'tables.setCellText',
    description:
      'Replace the text content of a single table cell with plain text (one paragraph). ' +
      'Accepts either a direct cell locator (a tableCell block address with kind, nodeType, nodeId) OR a table target with rowIndex + columnIndex. ' +
      'Cell properties (vertical alignment, shading, borders, colspan/rowspan) are preserved. ' +
      'Use this for filling cells with values, replacing cell text, or populating empty tables. Much simpler than walking paragraphs and runs through superdoc_edit.',
    expectedResult:
      'Returns a TableMutationResult receipt; reports NO_OP if the cell already contains exactly this text.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      // Cell text is authored as a structural replacement of the cell body, so
      // this operation cannot emit its own reviewable revision and must not
      // advertise tracked support.
      supportsTrackedMode: false,
      // It is nonetheless permitted for one target class: a cell whose row was
      // tracked-inserted by the same author. That row's `<w:ins>` already owns
      // the accept/reject fate of everything inside it, so filling the cell
      // directly is what the editor does when you type into such a row, and
      // rejecting the row removes the text with it. Only the adapter can tell
      // whether a given cell qualifies, so transports must forward the tracked
      // call and let it decide instead of rejecting on metadata alone.
      supportsConditionalTrackedMode: true,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/set-cell-text.mdx',
    referenceGroup: 'tables',
    intentGroup: 'table',
    intentAction: 'set_cell_text',
  },
  // -------------------------------------------------------------------------
  // Tables: data + accessibility
  // -------------------------------------------------------------------------
  'tables.sort': {
    memberPath: 'tables.sort',
    description: 'Sort table rows by a column value.',
    expectedResult: 'Returns a TableMutationResult receipt confirming rows were reordered.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/sort.mdx',
    referenceGroup: 'tables',
  },
  'tables.setAltText': {
    memberPath: 'tables.setAltText',
    description: 'Set the alternative text description for a table.',
    expectedResult: 'Returns a TableMutationResult receipt; reports NO_OP if alt text already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/set-alt-text.mdx',
    referenceGroup: 'tables',
  },
  // -------------------------------------------------------------------------
  // Tables: style
  // -------------------------------------------------------------------------
  'tables.setStyle': {
    memberPath: 'tables.setStyle',
    description: 'Apply a named table style to the target table, or clear the style when styleId is omitted.',
    expectedResult:
      'Returns a TableMutationResult receipt; reports NO_OP if the table already uses the requested style or has no style to clear.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/set-style.mdx',
    referenceGroup: 'tables',
  },
  'tables.clearStyle': {
    memberPath: 'tables.clearStyle',
    description: 'Remove the applied table style, reverting to defaults.',
    expectedResult: 'Returns a TableMutationResult receipt; reports NO_OP if no table style is applied.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/clear-style.mdx',
    referenceGroup: 'tables',
  },
  'tables.setStyleOption': {
    memberPath: 'tables.setStyleOption',
    description: 'Toggle a conditional style option such as banded rows or first column.',
    expectedResult: 'Returns a TableMutationResult receipt; reports NO_OP if the style option already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/set-style-option.mdx',
    referenceGroup: 'tables',
  },
  'tables.setBorder': {
    memberPath: 'tables.setBorder',
    description: 'Set border properties on a table or cell range.',
    expectedResult: 'Returns a TableMutationResult receipt; reports NO_OP if border properties already match.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/set-border.mdx',
    referenceGroup: 'tables',
  },
  'tables.clearBorder': {
    memberPath: 'tables.clearBorder',
    description: 'Remove border formatting from a table or cell range.',
    expectedResult: 'Returns a TableMutationResult receipt; reports NO_OP if no borders are set.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/clear-border.mdx',
    referenceGroup: 'tables',
  },
  'tables.applyBorderPreset': {
    memberPath: 'tables.applyBorderPreset',
    description: 'Apply a border preset (e.g. all borders, outside only) to a table.',
    expectedResult: 'Returns a TableMutationResult receipt; reports NO_OP if the preset is already applied.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/apply-border-preset.mdx',
    referenceGroup: 'tables',
  },
  'tables.setShading': {
    memberPath: 'tables.setShading',
    description: 'Set the background shading color on a table or cell range.',
    expectedResult: 'Returns a TableMutationResult receipt; reports NO_OP if shading already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/set-shading.mdx',
    referenceGroup: 'tables',
    intentGroup: 'table',
    intentAction: 'set_shading',
  },
  'tables.clearShading': {
    memberPath: 'tables.clearShading',
    description: 'Remove shading from a table or cell range.',
    expectedResult: 'Returns a TableMutationResult receipt; reports NO_OP if no shading is set.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/clear-shading.mdx',
    referenceGroup: 'tables',
  },
  'tables.setTablePadding': {
    memberPath: 'tables.setTablePadding',
    description: 'Set default cell padding for the entire table.',
    expectedResult: 'Returns a TableMutationResult receipt; reports NO_OP if table padding already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/set-table-padding.mdx',
    referenceGroup: 'tables',
  },
  'tables.setCellPadding': {
    memberPath: 'tables.setCellPadding',
    description: 'Set padding on a specific table cell or cell range.',
    expectedResult: 'Returns a TableMutationResult receipt; reports NO_OP if cell padding already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/set-cell-padding.mdx',
    referenceGroup: 'tables',
  },
  'tables.setCellSpacing': {
    memberPath: 'tables.setCellSpacing',
    description: 'Set the cell spacing for the target table.',
    expectedResult: 'Returns a TableMutationResult receipt; reports NO_OP if cell spacing already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/set-cell-spacing.mdx',
    referenceGroup: 'tables',
  },
  'tables.clearCellSpacing': {
    memberPath: 'tables.clearCellSpacing',
    description: 'Remove custom cell spacing from the target table.',
    expectedResult: 'Returns a TableMutationResult receipt; reports NO_OP if no custom cell spacing is set.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/clear-cell-spacing.mdx',
    referenceGroup: 'tables',
  },
  // -------------------------------------------------------------------------
  // Tables: convenience operations (SD-2129)
  // -------------------------------------------------------------------------
  'tables.applyStyle': {
    memberPath: 'tables.applyStyle',
    description:
      'Toggle conditional-format flags (header row, banded rows/columns, first/last column, last row) on a table. ' +
      'Pass `styleOptions` with the flags you want to set or clear (omitted flags stay unchanged). ' +
      'For "format the first row as a header" use `styleOptions: { headerRow: true }`. ' +
      'Optional `styleId` applies a named table style. Leave it unset unless you have a styleId from `superdoc_get_content` (no need to invent one).',
    expectedResult:
      'Returns a TableMutationResult receipt; reports NO_OP if the style and all provided options already match.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'INVALID_INPUT'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/apply-style.mdx',
    referenceGroup: 'tables',
    intentGroup: 'table',
    intentAction: 'set_style_options',
  },
  'tables.setBorders': {
    memberPath: 'tables.setBorders',
    description: 'Set borders on a table using a target set or per-edge patch.',
    expectedResult: 'Returns a TableMutationResult receipt. Does not perform NO_OP detection.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'INVALID_INPUT'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/set-borders.mdx',
    referenceGroup: 'tables',
    intentGroup: 'table',
    intentAction: 'set_borders',
  },
  'tables.setTableOptions': {
    memberPath: 'tables.setTableOptions',
    description: 'Set table-level default cell margins and/or cell spacing.',
    expectedResult:
      'Returns a TableMutationResult receipt; reports NO_OP if the provided values already match current direct formatting.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'INVALID_INPUT'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/set-table-options.mdx',
    referenceGroup: 'tables',
    intentGroup: 'table',
    intentAction: 'set_options',
  },
  'tables.applyPreset': {
    memberPath: 'tables.applyPreset',
    description:
      'Apply a named visual preset to a table. Presets: "grid" (1pt black borders all around), "minimal" (no outer borders, hairline grey row separators + thicker bottom), "striped" (banded rows on, 0.5pt grey borders), "accent" (filled header row + thick accent top/bottom; defaults to dark blue, override with `accentColor`). ' +
      'Composes set_borders + set_style_options + header-row shading in one call. Available via the document API and `superdoc_mutations` (intentionally NOT exposed as a top-level action on `superdoc_table`. Agents should compose explicit set_borders / set_shading / set_style_options calls so they always pick concrete colors that match the document context).',
    expectedResult: 'Returns a TableMutationResult receipt.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET'],
      throws: T_NOT_FOUND_COMMAND,
    }),
    referenceDocPath: 'tables/apply-preset.mdx',
    referenceGroup: 'tables',
  },
  // -------------------------------------------------------------------------
  // Tables: read operations (B4 ref handoff)
  // -------------------------------------------------------------------------
  'tables.get': {
    memberPath: 'tables.get',
    description: 'Retrieve table structure and dimensions by locator.',
    expectedResult: 'Returns a TablesGetOutput with the table row count, column count, and structural metadata.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: T_NOT_FOUND,
    }),
    referenceDocPath: 'tables/get.mdx',
    referenceGroup: 'tables',
  },
  'tables.getCells': {
    memberPath: 'tables.getCells',
    description: 'Retrieve cell information for a table, optionally filtered by row or column.',
    expectedResult: 'Returns a TablesGetCellsOutput with cell information for the requested rows and columns.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: T_NOT_FOUND,
    }),
    referenceDocPath: 'tables/get-cells.mdx',
    referenceGroup: 'tables',
  },
  'tables.getProperties': {
    memberPath: 'tables.getProperties',
    description: 'Retrieve layout and style properties of a table.',
    expectedResult:
      'Returns a TablesGetPropertiesOutput with direct table layout and style state, including style options, borders, default cell margins, and cell spacing when explicitly set.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: T_NOT_FOUND,
    }),
    referenceDocPath: 'tables/get-properties.mdx',
    referenceGroup: 'tables',
  },
  'tables.getStyles': {
    memberPath: 'tables.getStyles',
    description: 'List all table styles and the document-level default table style setting.',
    expectedResult: 'Returns a TablesGetStylesOutput with the style catalog, explicit default, and effective default.',
    requiresDocumentContext: true,
    metadata: readOperation({ idempotency: 'idempotent' }),
    referenceDocPath: 'tables/get-styles.mdx',
    referenceGroup: 'tables',
  },
  'tables.setDefaultStyle': {
    memberPath: 'tables.setDefaultStyle',
    description: 'Set the document-level default table style (w:defaultTableStyle in settings.xml).',
    expectedResult: 'Returns a DocumentMutationResult; reports NO_OP if the default already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_INPUT'],
      throws: ['CAPABILITY_UNAVAILABLE', 'INVALID_INPUT'],
      historyUnsafe: true,
    }),
    referenceDocPath: 'tables/set-default-style.mdx',
    referenceGroup: 'tables',
  },
  'tables.clearDefaultStyle': {
    memberPath: 'tables.clearDefaultStyle',
    description: 'Remove the document-level default table style setting.',
    expectedResult: 'Returns a DocumentMutationResult; reports NO_OP if no default is set.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: ['CAPABILITY_UNAVAILABLE'],
      historyUnsafe: true,
    }),
    referenceDocPath: 'tables/clear-default-style.mdx',
    referenceGroup: 'tables',
  },
  // -------------------------------------------------------------------------
  // Create: table of contents
  // -------------------------------------------------------------------------
  'create.tableOfContents': {
    memberPath: 'create.tableOfContents',
    description: 'Insert a new table of contents at the target position.',
    expectedResult: 'Returns a CreateTableOfContentsResult with the new TOC block address.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_INSERTION_CONTEXT'],
      throws: ['INVALID_TARGET', 'TARGET_NOT_FOUND', 'INVALID_INPUT', 'CAPABILITY_UNAVAILABLE'],
    }),
    referenceDocPath: 'create/table-of-contents.mdx',
    referenceGroup: 'create',
  },
  // -------------------------------------------------------------------------
  // TOC: lifecycle + configuration
  // -------------------------------------------------------------------------
  'toc.list': {
    memberPath: 'toc.list',
    description: 'List all tables of contents in the document.',
    expectedResult: 'Returns a TocListResult with an array of TOC discovery items and pagination metadata.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
    }),
    referenceDocPath: 'toc/list.mdx',
    referenceGroup: 'toc',
  },
  'toc.get': {
    memberPath: 'toc.get',
    description: 'Retrieve details of a specific table of contents.',
    expectedResult: 'Returns a TocInfo object with the instruction, source/display configuration, and entry count.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: T_NOT_FOUND,
    }),
    referenceDocPath: 'toc/get.mdx',
    referenceGroup: 'toc',
  },
  'toc.configure': {
    memberPath: 'toc.configure',
    description: 'Update the configuration switches of a table of contents.',
    expectedResult: 'Returns a TocMutationResult with the updated TOC address on success, or a failure code on no-op.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: ['TARGET_NOT_FOUND', 'INVALID_TARGET', 'INVALID_INPUT', 'CAPABILITY_UNAVAILABLE'],
    }),
    referenceDocPath: 'toc/configure.mdx',
    referenceGroup: 'toc',
  },
  'toc.update': {
    memberPath: 'toc.update',
    description: 'Rebuild or refresh the materialized content of a table of contents.',
    expectedResult:
      'Returns a TocMutationResult with the TOC address on success, or a failure code if content is unchanged or page numbers cannot be resolved.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'PAGE_NUMBERS_NOT_MATERIALIZED', 'CAPABILITY_UNAVAILABLE'],
      throws: ['TARGET_NOT_FOUND', 'INVALID_TARGET', 'CAPABILITY_UNAVAILABLE'],
    }),
    referenceDocPath: 'toc/update.mdx',
    referenceGroup: 'toc',
  },
  'toc.remove': {
    memberPath: 'toc.remove',
    description: 'Remove a table of contents from the document.',
    expectedResult: 'Returns a TocMutationResult with the removed TOC address on success, or a failure code on no-op.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: ['TARGET_NOT_FOUND', 'INVALID_TARGET', 'CAPABILITY_UNAVAILABLE'],
    }),
    referenceDocPath: 'toc/remove.mdx',
    referenceGroup: 'toc',
  },
  // -------------------------------------------------------------------------
  // TOC: TC entry management (SD-1977)
  // -------------------------------------------------------------------------
  'toc.markEntry': {
    memberPath: 'toc.markEntry',
    description: 'Insert a TC (table of contents entry) field at the target paragraph.',
    expectedResult: 'Returns a TocEntryMutationResult with the created entry address on success.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_INSERTION_CONTEXT'],
      throws: ['TARGET_NOT_FOUND', 'INVALID_TARGET', 'INVALID_INPUT', 'CAPABILITY_UNAVAILABLE'],
    }),
    referenceDocPath: 'toc/mark-entry.mdx',
    referenceGroup: 'toc',
  },
  'toc.unmarkEntry': {
    memberPath: 'toc.unmarkEntry',
    description: 'Remove a TC (table of contents entry) field from the document.',
    expectedResult: 'Returns a TocEntryMutationResult with the removed entry address on success.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: ['TARGET_NOT_FOUND', 'INVALID_TARGET', 'CAPABILITY_UNAVAILABLE'],
    }),
    referenceDocPath: 'toc/unmark-entry.mdx',
    referenceGroup: 'toc',
  },
  'toc.listEntries': {
    memberPath: 'toc.listEntries',
    description: 'List all TC (table of contents entry) fields in the document body.',
    expectedResult: 'Returns a TocListEntriesResult with an array of TC entry discovery items and pagination metadata.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
    }),
    referenceDocPath: 'toc/list-entries.mdx',
    referenceGroup: 'toc',
  },
  'toc.getEntry': {
    memberPath: 'toc.getEntry',
    description: 'Retrieve details of a specific TC (table of contents entry) field.',
    expectedResult: 'Returns a TocEntryInfo object with the instruction, text, level, and switch configuration.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: T_NOT_FOUND,
    }),
    referenceDocPath: 'toc/get-entry.mdx',
    referenceGroup: 'toc',
  },
  'toc.editEntry': {
    memberPath: 'toc.editEntry',
    description: 'Update the properties of a TC (table of contents entry) field.',
    expectedResult:
      'Returns a TocEntryMutationResult with the updated entry address on success, or NO_OP if no change.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: ['TARGET_NOT_FOUND', 'INVALID_TARGET', 'INVALID_INPUT', 'CAPABILITY_UNAVAILABLE'],
    }),
    referenceDocPath: 'toc/edit-entry.mdx',
    referenceGroup: 'toc',
  },
  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------
  'history.get': {
    memberPath: 'history.get',
    description: 'Query the current undo/redo history state of the document.',
    expectedResult:
      'Returns a HistoryState object with undoDepth, redoDepth, canUndo, canRedo, and a list of history-unsafe operations.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
    }),
    referenceDocPath: 'history/get.mdx',
    referenceGroup: 'history',
  },
  'history.undo': {
    memberPath: 'history.undo',
    description: 'Undo the most recent history-safe mutation in the document.',
    expectedResult:
      'Returns a HistoryActionResult with noop flag, revision before/after, optional noop reason, and optional ref-effect fields such as inserted, removed, invalidatedRefs, remappedRefs, and affectedStories.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: false,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: ['CAPABILITY_UNAVAILABLE'],
    }),
    referenceDocPath: 'history/undo.mdx',
    referenceGroup: 'history',
    intentGroup: 'edit',
    intentAction: 'undo',
  },
  'history.redo': {
    memberPath: 'history.redo',
    description: 'Redo the most recently undone action in the document.',
    expectedResult:
      'Returns a HistoryActionResult with noop flag, revision before/after, optional noop reason, and optional ref-effect fields such as inserted, removed, invalidatedRefs, remappedRefs, and affectedStories.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: false,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: ['CAPABILITY_UNAVAILABLE'],
    }),
    referenceDocPath: 'history/redo.mdx',
    referenceGroup: 'history',
    intentGroup: 'edit',
    intentAction: 'redo',
  },
  // -------------------------------------------------------------------------
  // Create: image
  // -------------------------------------------------------------------------
  'create.image': {
    memberPath: 'create.image',
    description: 'Insert a new image at the target position.',
    expectedResult:
      'Returns a CreateImageResult with the new image address. Tracked-mode results include `trackedChangeRefs` pointing at the tracked insertion review entity.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['INVALID_TARGET', 'INVALID_INPUT'],
      throws: [...T_NOT_FOUND_COMMAND, 'INVALID_INPUT', ...T_STORY],
    }),
    referenceDocPath: 'create/image.mdx',
    referenceGroup: 'create',
  },
  // -------------------------------------------------------------------------
  // Images: lifecycle + placement
  // -------------------------------------------------------------------------
  'images.list': {
    memberPath: 'images.list',
    description: 'List all images in the document.',
    expectedResult: 'Returns an ImagesListResult with total count and image summaries.',
    requiresDocumentContext: true,
    metadata: readOperation({ idempotency: 'idempotent', deterministicTargetResolution: true }),
    referenceDocPath: 'images/list.mdx',
    referenceGroup: 'images',
  },
  'images.get': {
    memberPath: 'images.get',
    description: 'Get details for a specific image by its stable ID.',
    expectedResult: 'Returns an ImageSummary with full image properties.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: ['TARGET_NOT_FOUND', 'AMBIGUOUS_TARGET'],
      deterministicTargetResolution: true,
    }),
    referenceDocPath: 'images/get.mdx',
    referenceGroup: 'images',
  },
  'images.delete': {
    memberPath: 'images.delete',
    description: 'Delete an image from the document.',
    expectedResult: 'Returns an ImagesMutationResult indicating success or failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_IMAGE_COMMAND,
    }),
    referenceDocPath: 'images/delete.mdx',
    referenceGroup: 'images',
  },
  'images.move': {
    memberPath: 'images.move',
    description:
      'Move an image to a new location in the document. Tracked-mode authoring supports safe sole inline-image body paragraphs and emits paired `<w:moveFrom>` / `<w:moveTo>` wrappers with explicit move range marker identity.',
    expectedResult:
      'Returns an ImagesMutationResult indicating success or failure. Tracked-mode results include `trackedChangeRefs` pointing at the paired move review entity.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP', 'CAPABILITY_UNAVAILABLE'],
      throws: T_IMAGE_COMMAND,
    }),
    referenceDocPath: 'images/move.mdx',
    referenceGroup: 'images',
  },
  'images.convertToInline': {
    memberPath: 'images.convertToInline',
    description: 'Convert a floating image to inline placement.',
    expectedResult: 'Returns an ImagesMutationResult; reports NO_OP if already inline.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_IMAGE_COMMAND,
    }),
    referenceDocPath: 'images/convert-to-inline.mdx',
    referenceGroup: 'images',
  },
  'images.convertToFloating': {
    memberPath: 'images.convertToFloating',
    description: 'Convert an inline image to floating placement.',
    expectedResult: 'Returns an ImagesMutationResult; reports NO_OP if already floating.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_IMAGE_COMMAND,
    }),
    referenceDocPath: 'images/convert-to-floating.mdx',
    referenceGroup: 'images',
  },
  'images.setSize': {
    memberPath: 'images.setSize',
    description: 'Set explicit width/height for an image.',
    expectedResult: 'Returns an ImagesMutationResult; reports NO_OP if the size already matches.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: [...T_IMAGE_COMMAND, 'INVALID_INPUT'],
    }),
    referenceDocPath: 'images/set-size.mdx',
    referenceGroup: 'images',
  },
  'images.setWrapType': {
    memberPath: 'images.setWrapType',
    description: 'Set the text wrapping type for a floating image.',
    expectedResult: 'Returns an ImagesMutationResult; reports NO_OP if already set.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_IMAGE_COMMAND,
    }),
    referenceDocPath: 'images/set-wrap-type.mdx',
    referenceGroup: 'images',
  },
  'images.setWrapSide': {
    memberPath: 'images.setWrapSide',
    description: 'Set which side(s) text wraps around a floating image.',
    expectedResult: 'Returns an ImagesMutationResult; reports NO_OP if already set.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_IMAGE_COMMAND,
    }),
    referenceDocPath: 'images/set-wrap-side.mdx',
    referenceGroup: 'images',
  },
  'images.setWrapDistances': {
    memberPath: 'images.setWrapDistances',
    description: 'Set the text-wrap distance margins for a floating image.',
    expectedResult: 'Returns an ImagesMutationResult; reports NO_OP if already set.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_IMAGE_COMMAND,
    }),
    referenceDocPath: 'images/set-wrap-distances.mdx',
    referenceGroup: 'images',
  },
  'images.setPosition': {
    memberPath: 'images.setPosition',
    description: 'Set the anchor position for a floating image.',
    expectedResult: 'Returns an ImagesMutationResult.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_IMAGE_COMMAND,
    }),
    referenceDocPath: 'images/set-position.mdx',
    referenceGroup: 'images',
  },
  'images.setAnchorOptions': {
    memberPath: 'images.setAnchorOptions',
    description: 'Set anchor behavior options for a floating image.',
    expectedResult: 'Returns an ImagesMutationResult.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_IMAGE_COMMAND,
    }),
    referenceDocPath: 'images/set-anchor-options.mdx',
    referenceGroup: 'images',
  },
  'images.setZOrder': {
    memberPath: 'images.setZOrder',
    description: 'Set the z-order (relativeHeight) for a floating image.',
    expectedResult: 'Returns an ImagesMutationResult.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_IMAGE_COMMAND,
    }),
    referenceDocPath: 'images/set-z-order.mdx',
    referenceGroup: 'images',
  },
  // --- SD-2100: Geometry ---
  'images.scale': {
    memberPath: 'images.scale',
    description: 'Scale an image by a uniform factor applied to both dimensions.',
    expectedResult: 'Returns an ImagesMutationResult with the updated image address.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: [...T_IMAGE_COMMAND, 'INVALID_INPUT'],
    }),
    referenceDocPath: 'images/scale.mdx',
    referenceGroup: 'images',
  },
  'images.setLockAspectRatio': {
    memberPath: 'images.setLockAspectRatio',
    description: 'Lock or unlock the aspect ratio for an image.',
    expectedResult: 'Returns an ImagesMutationResult; reports NO_OP if already set.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: [...T_IMAGE_COMMAND, 'INVALID_INPUT'],
    }),
    referenceDocPath: 'images/set-lock-aspect-ratio.mdx',
    referenceGroup: 'images',
  },
  'images.rotate': {
    memberPath: 'images.rotate',
    description: 'Set the absolute rotation angle for an image.',
    expectedResult: 'Returns an ImagesMutationResult; reports NO_OP if already set.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: [...T_IMAGE_COMMAND, 'INVALID_INPUT'],
    }),
    referenceDocPath: 'images/rotate.mdx',
    referenceGroup: 'images',
  },
  'images.flip': {
    memberPath: 'images.flip',
    description: 'Set horizontal and/or vertical flip state for an image.',
    expectedResult: 'Returns an ImagesMutationResult; reports NO_OP if already set.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: [...T_IMAGE_COMMAND, 'INVALID_INPUT'],
    }),
    referenceDocPath: 'images/flip.mdx',
    referenceGroup: 'images',
  },
  'images.crop': {
    memberPath: 'images.crop',
    description: 'Apply rectangular edge-percentage crop to an image.',
    expectedResult: 'Returns an ImagesMutationResult; reports NO_OP if unchanged.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: [...T_IMAGE_COMMAND, 'INVALID_INPUT'],
    }),
    referenceDocPath: 'images/crop.mdx',
    referenceGroup: 'images',
  },
  'images.resetCrop': {
    memberPath: 'images.resetCrop',
    description: 'Remove all cropping from an image.',
    expectedResult: 'Returns an ImagesMutationResult; reports NO_OP if no crop is set.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_IMAGE_COMMAND,
    }),
    referenceDocPath: 'images/reset-crop.mdx',
    referenceGroup: 'images',
  },
  // --- SD-2100: Content replacement ---
  'images.replaceSource': {
    memberPath: 'images.replaceSource',
    description: 'Replace the image source while preserving identity and placement.',
    expectedResult: 'Returns an ImagesMutationResult with the updated image address.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: [...T_IMAGE_COMMAND, 'INVALID_INPUT'],
    }),
    referenceDocPath: 'images/replace-source.mdx',
    referenceGroup: 'images',
  },
  // --- SD-2100: Semantic metadata ---
  'images.setAltText': {
    memberPath: 'images.setAltText',
    description: 'Set the accessibility description (alt text) for an image.',
    expectedResult: 'Returns an ImagesMutationResult; reports NO_OP if unchanged.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: [...T_IMAGE_COMMAND, 'INVALID_INPUT'],
    }),
    referenceDocPath: 'images/set-alt-text.mdx',
    referenceGroup: 'images',
  },
  'images.setDecorative': {
    memberPath: 'images.setDecorative',
    description: 'Mark or unmark an image as decorative.',
    expectedResult: 'Returns an ImagesMutationResult; reports NO_OP if unchanged.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: [...T_IMAGE_COMMAND, 'INVALID_INPUT'],
    }),
    referenceDocPath: 'images/set-decorative.mdx',
    referenceGroup: 'images',
  },
  'images.setName': {
    memberPath: 'images.setName',
    description: 'Set the object name for an image.',
    expectedResult: 'Returns an ImagesMutationResult; reports NO_OP if unchanged.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: [...T_IMAGE_COMMAND, 'INVALID_INPUT'],
    }),
    referenceDocPath: 'images/set-name.mdx',
    referenceGroup: 'images',
  },
  'images.setHyperlink': {
    memberPath: 'images.setHyperlink',
    description: 'Set or remove the hyperlink attached to an image.',
    expectedResult: 'Returns an ImagesMutationResult; reports NO_OP if unchanged.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: [...T_IMAGE_COMMAND, 'INVALID_INPUT'],
    }),
    referenceDocPath: 'images/set-hyperlink.mdx',
    referenceGroup: 'images',
  },
  // --- SD-2100: Caption lifecycle ---
  'images.insertCaption': {
    memberPath: 'images.insertCaption',
    description: 'Insert a caption paragraph below the image.',
    expectedResult: 'Returns an ImagesMutationResult with the image address.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: [...T_IMAGE_COMMAND, 'INVALID_INPUT'],
    }),
    referenceDocPath: 'images/insert-caption.mdx',
    referenceGroup: 'images',
  },
  'images.updateCaption': {
    memberPath: 'images.updateCaption',
    description: 'Update the text of an existing caption paragraph.',
    expectedResult: 'Returns an ImagesMutationResult; reports NO_OP if text unchanged.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: [...T_IMAGE_COMMAND, 'INVALID_INPUT'],
    }),
    referenceDocPath: 'images/update-caption.mdx',
    referenceGroup: 'images',
  },
  'images.removeCaption': {
    memberPath: 'images.removeCaption',
    description: 'Remove the caption paragraph from below the image.',
    expectedResult: 'Returns an ImagesMutationResult; reports NO_OP if no caption exists.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_IMAGE_COMMAND,
    }),
    referenceDocPath: 'images/remove-caption.mdx',
    referenceGroup: 'images',
  },
  // -------------------------------------------------------------------------
  // Hyperlinks: discovery + CRUD
  // -------------------------------------------------------------------------
  'hyperlinks.list': {
    memberPath: 'hyperlinks.list',
    description: 'List all hyperlinks in the document, with optional filtering by href, anchor, or display text.',
    expectedResult:
      'Returns a HyperlinksListResult with an array of hyperlink discovery items and pagination metadata.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
    }),
    referenceDocPath: 'hyperlinks/list.mdx',
    referenceGroup: 'hyperlinks',
  },
  'hyperlinks.get': {
    memberPath: 'hyperlinks.get',
    description: 'Retrieve details of a specific hyperlink by its inline address.',
    expectedResult: 'Returns a HyperlinkInfo object with the address, destination properties, and display text.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: ['TARGET_NOT_FOUND', 'INVALID_TARGET'],
    }),
    referenceDocPath: 'hyperlinks/get.mdx',
    referenceGroup: 'hyperlinks',
  },
  'hyperlinks.wrap': {
    memberPath: 'hyperlinks.wrap',
    description: 'Wrap an existing text range with a hyperlink.',
    expectedResult:
      'Returns a HyperlinkMutationResult with the created hyperlink address on success, or a failure code on no-op.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      deterministicTargetResolution: true,
      possibleFailureCodes: ['NO_OP'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET', 'INVALID_INPUT'],
    }),
    referenceDocPath: 'hyperlinks/wrap.mdx',
    referenceGroup: 'hyperlinks',
  },
  'hyperlinks.insert': {
    memberPath: 'hyperlinks.insert',
    description: 'Insert new linked text at a target position.',
    expectedResult:
      'Returns a HyperlinkMutationResult with the created hyperlink address on success, or a failure code.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: true,
      deterministicTargetResolution: true,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET', 'INVALID_INPUT'],
    }),
    referenceDocPath: 'hyperlinks/insert.mdx',
    referenceGroup: 'hyperlinks',
  },
  'hyperlinks.patch': {
    memberPath: 'hyperlinks.patch',
    description: 'Update hyperlink metadata (destination, tooltip, target, rel) without changing display text.',
    expectedResult:
      'Returns a HyperlinkMutationResult with the updated hyperlink address on success, or NO_OP if unchanged.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      deterministicTargetResolution: true,
      possibleFailureCodes: ['NO_OP'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET', 'INVALID_INPUT'],
    }),
    referenceDocPath: 'hyperlinks/patch.mdx',
    referenceGroup: 'hyperlinks',
  },
  'hyperlinks.remove': {
    memberPath: 'hyperlinks.remove',
    description:
      "Remove a hyperlink. Mode 'unwrap' preserves display text; 'deleteText' removes the linked content entirely.",
    expectedResult:
      'Returns a HyperlinkMutationResult with the removed hyperlink address on success, or a failure code on no-op.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      deterministicTargetResolution: true,
      possibleFailureCodes: ['NO_OP'],
      throws: [...T_NOT_FOUND_CAPABLE, 'INVALID_TARGET', 'INVALID_INPUT'],
    }),
    referenceDocPath: 'hyperlinks/remove.mdx',
    referenceGroup: 'hyperlinks',
  },
  // =========================================================================
  // headerFooters.*
  // =========================================================================
  'headerFooters.list': {
    memberPath: 'headerFooters.list',
    description: 'List header/footer slot entries across sections.',
    expectedResult: 'Returns a paginated DiscoveryOutput of HeaderFooterSlotEntry items.',
    requiresDocumentContext: true,
    metadata: readOperation({
      throws: ['INVALID_INPUT', 'INVALID_TARGET'],
    }),
    referenceDocPath: 'header-footers/list.mdx',
    referenceGroup: 'headerFooters',
  },
  'headerFooters.get': {
    memberPath: 'headerFooters.get',
    description: 'Get a single header/footer slot entry by address.',
    expectedResult: 'Returns a HeaderFooterSlotEntry for the targeted section slot.',
    requiresDocumentContext: true,
    metadata: readOperation({
      throws: ['TARGET_NOT_FOUND', 'INVALID_TARGET', 'INVALID_INPUT'],
    }),
    referenceDocPath: 'header-footers/get.mdx',
    referenceGroup: 'headerFooters',
  },
  'headerFooters.resolve': {
    memberPath: 'headerFooters.resolve',
    description: 'Resolve the effective header/footer reference for a slot, walking the section inheritance chain.',
    expectedResult:
      'Returns a HeaderFooterResolveResult indicating explicit, inherited, or none status with the resolved refId.',
    requiresDocumentContext: true,
    metadata: readOperation({
      throws: ['TARGET_NOT_FOUND', 'INVALID_TARGET', 'INVALID_INPUT'],
    }),
    referenceDocPath: 'header-footers/resolve.mdx',
    referenceGroup: 'headerFooters',
  },
  'headerFooters.refs.set': {
    memberPath: 'headerFooters.refs.set',
    description: 'Set an explicit header/footer reference on a section slot.',
    expectedResult:
      'Returns a SectionMutationResult receipt; reports NO_OP if the reference already matches, INVALID_TARGET if the relationship does not exist.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'CAPABILITY_UNAVAILABLE'],
      throws: T_HEADER_FOOTER_MUTATION,
      historyUnsafe: true,
    }),
    referenceDocPath: 'header-footers/refs/set.mdx',
    referenceGroup: 'headerFooters',
  },
  'headerFooters.refs.clear': {
    memberPath: 'headerFooters.refs.clear',
    description: 'Clear an explicit header/footer reference from a section slot.',
    expectedResult: 'Returns a SectionMutationResult receipt; reports NO_OP if no explicit reference existed.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_HEADER_FOOTER_MUTATION,
      historyUnsafe: true,
    }),
    referenceDocPath: 'header-footers/refs/clear.mdx',
    referenceGroup: 'headerFooters',
  },
  'headerFooters.refs.setLinkedToPrevious': {
    memberPath: 'headerFooters.refs.setLinkedToPrevious',
    description: 'Link or unlink a header/footer slot to/from the previous section.',
    expectedResult:
      'Returns a SectionMutationResult receipt; reports NO_OP if the link state already matches, INVALID_TARGET for the first section.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP', 'INVALID_TARGET', 'CAPABILITY_UNAVAILABLE'],
      throws: T_HEADER_FOOTER_MUTATION,
      historyUnsafe: true,
    }),
    referenceDocPath: 'header-footers/refs/set-linked-to-previous.mdx',
    referenceGroup: 'headerFooters',
  },
  'headerFooters.parts.list': {
    memberPath: 'headerFooters.parts.list',
    description: 'List unique header/footer part records from document relationships.',
    expectedResult: 'Returns a paginated DiscoveryOutput of HeaderFooterPartEntry items.',
    requiresDocumentContext: true,
    metadata: readOperation({
      throws: ['CAPABILITY_UNAVAILABLE', 'INVALID_INPUT'],
    }),
    referenceDocPath: 'header-footers/parts/list.mdx',
    referenceGroup: 'headerFooters',
  },
  'headerFooters.parts.create': {
    memberPath: 'headerFooters.parts.create',
    description: 'Create a new independent header/footer part, optionally cloned from an existing part.',
    expectedResult:
      'Returns a HeaderFooterPartsMutationResult with the new refId/partPath on success, INVALID_TARGET failure when sourceRefId is invalid or mismatched.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET'],
      throws: ['INVALID_TARGET', 'INVALID_INPUT', 'CAPABILITY_UNAVAILABLE', 'INTERNAL_ERROR'],
      historyUnsafe: true,
    }),
    referenceDocPath: 'header-footers/parts/create.mdx',
    referenceGroup: 'headerFooters',
  },
  'headerFooters.parts.delete': {
    memberPath: 'headerFooters.parts.delete',
    description: 'Delete a header/footer part and its associated relationship when no section slots reference it.',
    expectedResult:
      'Returns a HeaderFooterPartsMutationResult on success; INVALID_TARGET failure if sections still reference the part.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET'],
      throws: ['TARGET_NOT_FOUND', 'INVALID_TARGET', 'INVALID_INPUT', 'CAPABILITY_UNAVAILABLE', 'INTERNAL_ERROR'],
      historyUnsafe: true,
    }),
    referenceDocPath: 'header-footers/parts/delete.mdx',
    referenceGroup: 'headerFooters',
  },
  // =========================================================================
  // Content Controls (SD-2070)
  // =========================================================================
  // --- A. Core CRUD + Discovery ---
  'create.contentControl': {
    memberPath: 'create.contentControl',
    description:
      'Create a new content control (SDT) in the document, optionally seeded with plain text or structured block preset content.',
    expectedResult: 'Returns a ContentControlMutationResult with the created content control target.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_TARGET', 'NO_OP'],
      throws: T_CC_MUTATION,
    }),
    referenceDocPath: 'content-controls/create.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.list': {
    memberPath: 'contentControls.list',
    description: 'List all content controls in the document with optional type/tag filtering.',
    expectedResult: 'Returns a ContentControlsListResult with items and total count.',
    requiresDocumentContext: true,
    metadata: readOperation({ throws: T_CC_READ }),
    referenceDocPath: 'content-controls/list.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.get': {
    memberPath: 'contentControls.get',
    description: 'Retrieve a single content control by target.',
    expectedResult: 'Returns a ContentControlInfo with full properties.',
    requiresDocumentContext: true,
    metadata: readOperation({ throws: T_CC_READ }),
    referenceDocPath: 'content-controls/get.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.listInRange': {
    memberPath: 'contentControls.listInRange',
    description: 'List content controls within a block range.',
    expectedResult: 'Returns a ContentControlsListResult scoped to the range.',
    requiresDocumentContext: true,
    metadata: readOperation({ throws: T_CC_READ }),
    referenceDocPath: 'content-controls/list-in-range.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.selectByTag': {
    memberPath: 'contentControls.selectByTag',
    description: 'Select content controls matching a specific tag value.',
    expectedResult: 'Returns a ContentControlsListResult with matching items.',
    requiresDocumentContext: true,
    metadata: readOperation({ throws: T_CC_READ }),
    referenceDocPath: 'content-controls/select-by-tag.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.selectByTitle': {
    memberPath: 'contentControls.selectByTitle',
    description: 'Select content controls matching a specific title (alias) value.',
    expectedResult: 'Returns a ContentControlsListResult with matching items.',
    requiresDocumentContext: true,
    metadata: readOperation({ throws: T_CC_READ }),
    referenceDocPath: 'content-controls/select-by-title.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.listChildren': {
    memberPath: 'contentControls.listChildren',
    description: 'List direct child content controls nested inside the target.',
    expectedResult: 'Returns a ContentControlsListResult with child items.',
    requiresDocumentContext: true,
    metadata: readOperation({ throws: T_CC_READ }),
    referenceDocPath: 'content-controls/list-children.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.getParent': {
    memberPath: 'contentControls.getParent',
    description: 'Get the parent content control of the target, if any.',
    expectedResult: 'Returns a ContentControlInfo for the parent, or null if no parent SDT exists.',
    requiresDocumentContext: true,
    metadata: readOperation({ throws: T_CC_READ }),
    referenceDocPath: 'content-controls/get-parent.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.wrap': {
    memberPath: 'contentControls.wrap',
    description: 'Wrap existing content with a new content control.',
    expectedResult: 'Returns a ContentControlMutationResult with the wrapper target.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_MUTATION,
    }),
    referenceDocPath: 'content-controls/wrap.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.unwrap': {
    memberPath: 'contentControls.unwrap',
    description: 'Remove the content control wrapper, preserving its content in place.',
    expectedResult: 'Returns a ContentControlMutationResult; reports NO_OP if already unwrapped.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_MUTATION,
    }),
    referenceDocPath: 'content-controls/unwrap.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.delete': {
    memberPath: 'contentControls.delete',
    description: 'Delete a content control and its content from the document.',
    expectedResult: 'Returns a ContentControlMutationResult; reports NO_OP if already removed.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_MUTATION,
    }),
    referenceDocPath: 'content-controls/delete.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.copy': {
    memberPath: 'contentControls.copy',
    description: 'Copy a content control to a destination position. Copied SDTs receive new IDs.',
    expectedResult: 'Returns a ContentControlMutationResult with the copied content control target.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_MUTATION,
    }),
    referenceDocPath: 'content-controls/copy.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.move': {
    memberPath: 'contentControls.move',
    description:
      'Move a content control to a new position: before or after another SDT, to the document start or end, or to an arbitrary caret inside a paragraph (the inParagraph destination) for drag-and-drop. Direct moves preserve the original ID; tracked-mode authoring supports safe top-level block SDTs (SDT-to-SDT destinations only) and remaps the destination SDT ID to avoid duplicate live anchors.',
    expectedResult:
      'Returns a ContentControlMutationResult with the updated target position. Tracked-mode results include `trackedChangeRefs` pointing at the paired move review entity.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP', 'CAPABILITY_UNAVAILABLE'],
      throws: T_CC_MUTATION,
    }),
    referenceDocPath: 'content-controls/move.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.patch': {
    memberPath: 'contentControls.patch',
    description: 'Patch metadata properties on a content control (tag, alias, appearance, color, etc.).',
    expectedResult: 'Returns a ContentControlMutationResult; reports NO_OP if no fields changed.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_MUTATION,
    }),
    referenceDocPath: 'content-controls/patch.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.setLockMode': {
    memberPath: 'contentControls.setLockMode',
    description: 'Set the lock mode on a content control.',
    expectedResult: 'Returns a ContentControlMutationResult; reports NO_OP if lock mode unchanged.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_MUTATION,
    }),
    referenceDocPath: 'content-controls/set-lock-mode.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.setType': {
    memberPath: 'contentControls.setType',
    description:
      'Transition a content control to a different semantic type. Metadata-only; no implicit content rewrite.',
    expectedResult: 'Returns a ContentControlMutationResult; reports NO_OP if type unchanged.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_TYPED,
    }),
    referenceDocPath: 'content-controls/set-type.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.getContent': {
    memberPath: 'contentControls.getContent',
    description: 'Get the text content of a content control.',
    expectedResult: 'Returns a ContentControlsGetContentResult with the content string and format.',
    requiresDocumentContext: true,
    metadata: readOperation({ throws: T_CC_READ }),
    referenceDocPath: 'content-controls/get-content.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.replaceContent': {
    memberPath: 'contentControls.replaceContent',
    description: 'Replace the entire content of a content control.',
    expectedResult: 'Returns a ContentControlMutationResult with the updated target.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_MUTATION,
    }),
    referenceDocPath: 'content-controls/replace-content.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.clearContent': {
    memberPath: 'contentControls.clearContent',
    description: 'Clear all content inside a content control, leaving it empty.',
    expectedResult: 'Returns a ContentControlMutationResult; reports NO_OP if already empty.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_MUTATION,
    }),
    referenceDocPath: 'content-controls/clear-content.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.appendContent': {
    memberPath: 'contentControls.appendContent',
    description: 'Append content to the end of a content control.',
    expectedResult: 'Returns a ContentControlMutationResult with the updated target.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_MUTATION,
    }),
    referenceDocPath: 'content-controls/append-content.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.prependContent': {
    memberPath: 'contentControls.prependContent',
    description: 'Prepend content to the beginning of a content control.',
    expectedResult: 'Returns a ContentControlMutationResult with the updated target.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_MUTATION,
    }),
    referenceDocPath: 'content-controls/prepend-content.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.insertBefore': {
    memberPath: 'contentControls.insertBefore',
    description: 'Insert content immediately before a content control.',
    expectedResult: 'Returns a ContentControlMutationResult with the target.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_MUTATION,
    }),
    referenceDocPath: 'content-controls/insert-before.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.insertAfter': {
    memberPath: 'contentControls.insertAfter',
    description: 'Insert content immediately after a content control.',
    expectedResult: 'Returns a ContentControlMutationResult with the target.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_MUTATION,
    }),
    referenceDocPath: 'content-controls/insert-after.mdx',
    referenceGroup: 'contentControls',
  },
  // --- B. Data Binding + Raw/Compatibility ---
  'contentControls.getBinding': {
    memberPath: 'contentControls.getBinding',
    description: 'Get the data binding metadata (w:dataBinding) of a content control.',
    expectedResult: 'Returns the ContentControlBinding or null if no binding is set.',
    requiresDocumentContext: true,
    metadata: readOperation({ throws: T_CC_READ }),
    referenceDocPath: 'content-controls/get-binding.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.setBinding': {
    memberPath: 'contentControls.setBinding',
    description: 'Set data binding metadata on a content control.',
    expectedResult: 'Returns a ContentControlMutationResult; reports NO_OP if binding unchanged.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_MUTATION,
    }),
    referenceDocPath: 'content-controls/set-binding.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.clearBinding': {
    memberPath: 'contentControls.clearBinding',
    description: 'Remove data binding metadata from a content control.',
    expectedResult: 'Returns a ContentControlMutationResult; reports NO_OP if no binding existed.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_MUTATION,
    }),
    referenceDocPath: 'content-controls/clear-binding.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.getRawProperties': {
    memberPath: 'contentControls.getRawProperties',
    description: 'Get the raw sdtPr properties of a content control as a passthrough hash.',
    expectedResult: 'Returns a ContentControlsGetRawPropertiesResult with the raw properties.',
    requiresDocumentContext: true,
    metadata: readOperation({ throws: T_CC_READ }),
    referenceDocPath: 'content-controls/get-raw-properties.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.patchRawProperties': {
    memberPath: 'contentControls.patchRawProperties',
    description: 'Apply raw XML-level patches to the sdtPr subtree of a content control.',
    expectedResult: 'Returns a ContentControlMutationResult; reports NO_OP if no effective changes.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_RAW,
    }),
    referenceDocPath: 'content-controls/patch-raw-properties.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.validateWordCompatibility': {
    memberPath: 'contentControls.validateWordCompatibility',
    description: 'Validate a content control for Word compatibility issues.',
    expectedResult: 'Returns a compatibility result with diagnostics.',
    requiresDocumentContext: true,
    metadata: readOperation({ throws: T_CC_READ }),
    referenceDocPath: 'content-controls/validate-word-compatibility.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.normalizeWordCompatibility': {
    memberPath: 'contentControls.normalizeWordCompatibility',
    description: 'Normalize a content control to resolve Word compatibility issues.',
    expectedResult: 'Returns a ContentControlMutationResult; reports NO_OP if already compatible.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_RAW,
    }),
    referenceDocPath: 'content-controls/normalize-word-compatibility.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.normalizeTagPayload': {
    memberPath: 'contentControls.normalizeTagPayload',
    description: 'Normalize a content control tag between plain-string and JSON-encoded formats.',
    expectedResult: 'Returns a ContentControlMutationResult; reports NO_OP if already normalized.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_RAW,
    }),
    referenceDocPath: 'content-controls/normalize-tag-payload.mdx',
    referenceGroup: 'contentControls',
  },
  // --- C. Typed Controls ---
  'contentControls.text.setMultiline': {
    memberPath: 'contentControls.text.setMultiline',
    description: 'Set or clear the multiline attribute on a plain-text content control.',
    expectedResult: 'Returns a ContentControlMutationResult; reports NO_OP if unchanged.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_TYPED,
    }),
    referenceDocPath: 'content-controls/text/set-multiline.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.text.setValue': {
    memberPath: 'contentControls.text.setValue',
    description: 'Set the text value of a plain-text content control.',
    expectedResult: 'Returns a ContentControlMutationResult; reports NO_OP if unchanged.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_TYPED,
    }),
    referenceDocPath: 'content-controls/text/set-value.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.text.clearValue': {
    memberPath: 'contentControls.text.clearValue',
    description: 'Clear the text value of a plain-text content control.',
    expectedResult: 'Returns a ContentControlMutationResult; reports NO_OP if already empty.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_TYPED,
    }),
    referenceDocPath: 'content-controls/text/clear-value.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.date.setValue': {
    memberPath: 'contentControls.date.setValue',
    description: 'Set the date value of a date content control.',
    expectedResult: 'Returns a ContentControlMutationResult; reports NO_OP if unchanged.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_TYPED,
    }),
    referenceDocPath: 'content-controls/date/set-value.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.date.clearValue': {
    memberPath: 'contentControls.date.clearValue',
    description: 'Clear the date value of a date content control.',
    expectedResult: 'Returns a ContentControlMutationResult; reports NO_OP if already empty.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_TYPED,
    }),
    referenceDocPath: 'content-controls/date/clear-value.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.date.setDisplayFormat': {
    memberPath: 'contentControls.date.setDisplayFormat',
    description: 'Set the display format string for a date content control.',
    expectedResult: 'Returns a ContentControlMutationResult; reports NO_OP if unchanged.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_TYPED,
    }),
    referenceDocPath: 'content-controls/date/set-display-format.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.date.setDisplayLocale': {
    memberPath: 'contentControls.date.setDisplayLocale',
    description: 'Set the display locale for a date content control.',
    expectedResult: 'Returns a ContentControlMutationResult; reports NO_OP if unchanged.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_TYPED,
    }),
    referenceDocPath: 'content-controls/date/set-display-locale.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.date.setStorageFormat': {
    memberPath: 'contentControls.date.setStorageFormat',
    description: 'Set the XML storage format for a date content control.',
    expectedResult: 'Returns a ContentControlMutationResult; reports NO_OP if unchanged.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_TYPED,
    }),
    referenceDocPath: 'content-controls/date/set-storage-format.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.date.setCalendar': {
    memberPath: 'contentControls.date.setCalendar',
    description: 'Set the calendar type for a date content control.',
    expectedResult: 'Returns a ContentControlMutationResult; reports NO_OP if unchanged.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_TYPED,
    }),
    referenceDocPath: 'content-controls/date/set-calendar.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.checkbox.getState': {
    memberPath: 'contentControls.checkbox.getState',
    description: 'Get the checked state of a checkbox content control.',
    expectedResult: 'Returns a CheckboxGetStateResult with the checked boolean.',
    requiresDocumentContext: true,
    metadata: readOperation({ throws: T_CC_TYPED_READ }),
    referenceDocPath: 'content-controls/checkbox/get-state.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.checkbox.setState': {
    memberPath: 'contentControls.checkbox.setState',
    description: 'Set the checked state of a checkbox content control.',
    expectedResult: 'Returns a ContentControlMutationResult; reports NO_OP if unchanged.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_TYPED,
    }),
    referenceDocPath: 'content-controls/checkbox/set-state.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.checkbox.toggle': {
    memberPath: 'contentControls.checkbox.toggle',
    description: 'Toggle the checked state of a checkbox content control.',
    expectedResult: 'Returns a ContentControlMutationResult with the updated state.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_TYPED,
    }),
    referenceDocPath: 'content-controls/checkbox/toggle.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.checkbox.setSymbolPair': {
    memberPath: 'contentControls.checkbox.setSymbolPair',
    description: 'Set the checked and unchecked symbol glyphs for a checkbox content control.',
    expectedResult: 'Returns a ContentControlMutationResult; reports NO_OP if symbols unchanged.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_TYPED,
    }),
    referenceDocPath: 'content-controls/checkbox/set-symbol-pair.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.choiceList.getItems': {
    memberPath: 'contentControls.choiceList.getItems',
    description: 'Get the list items and selected value of a comboBox or dropDownList content control.',
    expectedResult: 'Returns a ChoiceListGetItemsResult with items and selectedValue.',
    requiresDocumentContext: true,
    metadata: readOperation({ throws: T_CC_TYPED_READ }),
    referenceDocPath: 'content-controls/choice-list/get-items.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.choiceList.setItems': {
    memberPath: 'contentControls.choiceList.setItems',
    description: 'Replace the list items of a comboBox or dropDownList content control.',
    expectedResult: 'Returns a ContentControlMutationResult; reports NO_OP if items unchanged.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_TYPED,
    }),
    referenceDocPath: 'content-controls/choice-list/set-items.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.choiceList.setSelected': {
    memberPath: 'contentControls.choiceList.setSelected',
    description: 'Set the selected value of a comboBox or dropDownList content control.',
    expectedResult: 'Returns a ContentControlMutationResult; reports NO_OP if selection unchanged.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_TYPED,
    }),
    referenceDocPath: 'content-controls/choice-list/set-selected.mdx',
    referenceGroup: 'contentControls',
  },
  // --- D. Repeating Section + Group ---
  'contentControls.repeatingSection.listItems': {
    memberPath: 'contentControls.repeatingSection.listItems',
    description: 'List the repeating section items inside a repeating section content control.',
    expectedResult: 'Returns a RepeatingSectionListItemsResult with child item info.',
    requiresDocumentContext: true,
    metadata: readOperation({ throws: T_CC_TYPED_READ }),
    referenceDocPath: 'content-controls/repeating-section/list-items.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.repeatingSection.insertItemBefore': {
    memberPath: 'contentControls.repeatingSection.insertItemBefore',
    description: 'Insert a new item before a specific index in a repeating section.',
    expectedResult: 'Returns a ContentControlMutationResult with the new item target.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_TYPED,
    }),
    referenceDocPath: 'content-controls/repeating-section/insert-item-before.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.repeatingSection.insertItemAfter': {
    memberPath: 'contentControls.repeatingSection.insertItemAfter',
    description: 'Insert a new item after a specific index in a repeating section.',
    expectedResult: 'Returns a ContentControlMutationResult with the new item target.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_TYPED,
    }),
    referenceDocPath: 'content-controls/repeating-section/insert-item-after.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.repeatingSection.cloneItem': {
    memberPath: 'contentControls.repeatingSection.cloneItem',
    description: 'Clone a repeating section item at the given index. Cloned SDTs receive new IDs.',
    expectedResult: 'Returns a ContentControlMutationResult with the cloned item target.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_TYPED,
    }),
    referenceDocPath: 'content-controls/repeating-section/clone-item.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.repeatingSection.deleteItem': {
    memberPath: 'contentControls.repeatingSection.deleteItem',
    description: 'Delete a repeating section item at the given index.',
    expectedResult: 'Returns a ContentControlMutationResult; reports NO_OP if item does not exist.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_TYPED,
    }),
    referenceDocPath: 'content-controls/repeating-section/delete-item.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.repeatingSection.setAllowInsertDelete': {
    memberPath: 'contentControls.repeatingSection.setAllowInsertDelete',
    description: 'Set the allowInsertDelete flag on a repeating section.',
    expectedResult: 'Returns a ContentControlMutationResult; reports NO_OP if unchanged.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_TYPED,
    }),
    referenceDocPath: 'content-controls/repeating-section/set-allow-insert-delete.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.group.wrap': {
    memberPath: 'contentControls.group.wrap',
    description: 'Wrap a content control inside a new group content control. Always nests; not idempotent.',
    expectedResult: 'Returns a ContentControlMutationResult with the new group wrapper target.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: [],
      throws: T_CC_MUTATION,
    }),
    referenceDocPath: 'content-controls/group/wrap.mdx',
    referenceGroup: 'contentControls',
  },
  'contentControls.group.ungroup': {
    memberPath: 'contentControls.group.ungroup',
    description: 'Remove the group designation from a group content control.',
    expectedResult: 'Returns a ContentControlMutationResult; reports NO_OP if not a group.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_CC_TYPED,
    }),
    referenceDocPath: 'content-controls/group/ungroup.mdx',
    referenceGroup: 'contentControls',
  },
  // Bookmarks
  // -------------------------------------------------------------------------
  'bookmarks.list': {
    memberPath: 'bookmarks.list',
    description: 'List all bookmarks in the document.',
    expectedResult: 'Returns a BookmarksListResult containing discovered bookmarks with address and domain data.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: T_REF_READ_LIST,
    }),
    referenceDocPath: 'bookmarks/list.mdx',
    referenceGroup: 'bookmarks',
  },
  'bookmarks.get': {
    memberPath: 'bookmarks.get',
    description: 'Get detailed information about a specific bookmark.',
    expectedResult: "Returns a BookmarkInfo object with the bookmark's name, range, and optional table-column data.",
    requiresDocumentContext: true,
    metadata: readOperation({
      throws: T_NOT_FOUND_CAPABLE,
    }),
    referenceDocPath: 'bookmarks/get.mdx',
    referenceGroup: 'bookmarks',
  },
  'bookmarks.insert': {
    memberPath: 'bookmarks.insert',
    description: 'Insert a new named bookmark at a target location.',
    expectedResult: 'Returns a BookmarkMutationResult indicating success with the bookmark address or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_INSERT,
    }),
    referenceDocPath: 'bookmarks/insert.mdx',
    referenceGroup: 'bookmarks',
  },
  'bookmarks.rename': {
    memberPath: 'bookmarks.rename',
    description: 'Rename an existing bookmark.',
    expectedResult:
      'Returns a BookmarkMutationResult indicating success with the updated bookmark address or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_MUTATION,
    }),
    referenceDocPath: 'bookmarks/rename.mdx',
    referenceGroup: 'bookmarks',
  },
  'bookmarks.remove': {
    memberPath: 'bookmarks.remove',
    description: 'Remove a bookmark from the document.',
    expectedResult: 'Returns a BookmarkMutationResult indicating success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_MUTATION_REMOVE,
    }),
    referenceDocPath: 'bookmarks/remove.mdx',
    referenceGroup: 'bookmarks',
  },
  // -------------------------------------------------------------------------
  // Footnotes
  // -------------------------------------------------------------------------
  'footnotes.list': {
    memberPath: 'footnotes.list',
    description: 'List all footnotes and endnotes in the document.',
    expectedResult: 'Returns a FootnotesListResult containing discovered footnotes with address and domain data.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: T_REF_READ_LIST,
    }),
    referenceDocPath: 'footnotes/list.mdx',
    referenceGroup: 'footnotes',
  },
  'footnotes.get': {
    memberPath: 'footnotes.get',
    description: 'Get detailed information about a specific footnote or endnote.',
    expectedResult: "Returns a FootnoteInfo object with the note's type, display number, and content.",
    requiresDocumentContext: true,
    metadata: readOperation({
      throws: T_NOT_FOUND_CAPABLE,
    }),
    referenceDocPath: 'footnotes/get.mdx',
    referenceGroup: 'footnotes',
  },
  'footnotes.insert': {
    memberPath: 'footnotes.insert',
    description: `Insert a new footnote or endnote at a target location or the current selection.${FOOTNOTE_STRUCTURED_BODY_V1_NOTE}`,
    expectedResult: 'Returns a FootnoteMutationResult indicating success with the footnote address or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: FOOTNOTE_MUTATION_FAILURES,
      throws: T_REF_INSERT,
    }),
    referenceDocPath: 'footnotes/insert.mdx',
    referenceGroup: 'footnotes',
  },
  'footnotes.update': {
    memberPath: 'footnotes.update',
    description: `Update the content of an existing footnote or endnote.${FOOTNOTE_STRUCTURED_BODY_V1_NOTE}`,
    expectedResult:
      'Returns a FootnoteMutationResult indicating success with the updated footnote address or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: FOOTNOTE_MUTATION_FAILURES,
      throws: T_REF_MUTATION,
    }),
    referenceDocPath: 'footnotes/update.mdx',
    referenceGroup: 'footnotes',
  },
  'footnotes.remove': {
    memberPath: 'footnotes.remove',
    description: 'Remove a footnote or endnote from the document.',
    expectedResult: 'Returns a FootnoteMutationResult indicating success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_MUTATION_REMOVE,
    }),
    referenceDocPath: 'footnotes/remove.mdx',
    referenceGroup: 'footnotes',
  },
  'footnotes.configure': {
    memberPath: 'footnotes.configure',
    description: 'Configure numbering and placement for footnotes or endnotes.',
    expectedResult: 'Returns a FootnoteConfigResult indicating success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_MUTATION,
    }),
    referenceDocPath: 'footnotes/configure.mdx',
    referenceGroup: 'footnotes',
  },
  // -------------------------------------------------------------------------
  // Clipboard
  // -------------------------------------------------------------------------
  'clipboard.parse': {
    memberPath: 'clipboard.parse',
    description:
      'Parse and sanitize a ClipboardPayload into a deterministic v2 clipboard insert plan with diagnostics. Does not mutate the document.',
    expectedResult: 'Returns a ClipboardParseResult with a ClipboardInsertPlan or a named fail-closed reason.',
    requiresDocumentContext: true,
    metadata: readOperation({
      possibleFailureCodes: [
        'INVALID_INPUT',
        'INVALID_PAYLOAD',
        'EMPTY_FRAGMENT',
        'CAPABILITY_UNSUPPORTED',
        'INVALID_FRAGMENT',
        'CAPABILITY_UNAVAILABLE',
      ],
    }),
    referenceDocPath: 'clipboard/parse.mdx',
    referenceGroup: 'clipboard',
  },
  'clipboard.insert': {
    memberPath: 'clipboard.insert',
    description:
      'Insert a parsed clipboard plan, v2 fragment, or raw ClipboardPayload through the v2 pasteFragment kernel operation.',
    expectedResult:
      'Returns a ClipboardInsertResult with inserted refs, diagnostics, and one paste transaction receipt, or a named fail-closed reason.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: true,
      possibleFailureCodes: [
        'INVALID_INPUT',
        'INVALID_TARGET',
        'INVALID_PAYLOAD',
        'EMPTY_FRAGMENT',
        'INVALID_FRAGMENT',
        'CAPABILITY_UNSUPPORTED',
        'CAPABILITY_UNAVAILABLE',
        'REVISION_MISMATCH',
        'PRECONDITION_FAILED',
      ],
      throws: T_REF_INSERT,
    }),
    referenceDocPath: 'clipboard/insert.mdx',
    referenceGroup: 'clipboard',
  },
  'clipboard.serializeSelection': {
    memberPath: 'clipboard.serializeSelection',
    description:
      'Serialize the current or supplied model selection into text/plain, text/html, and application/x-superdoc-v2-fragment clipboard payloads.',
    expectedResult: 'Returns a ClipboardSerializeResult containing the payload and normalized insert plan.',
    requiresDocumentContext: true,
    metadata: readOperation({
      possibleFailureCodes: ['INVALID_TARGET', 'CAPABILITY_UNAVAILABLE'],
    }),
    referenceDocPath: 'clipboard/serialize-selection.mdx',
    referenceGroup: 'clipboard',
  },
  // -------------------------------------------------------------------------
  // Cross-References
  // -------------------------------------------------------------------------
  'crossRefs.list': {
    memberPath: 'crossRefs.list',
    description: 'List all cross-reference fields in the document.',
    expectedResult:
      'Returns a CrossRefsListResult containing discovered cross-references with address and domain data.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: T_REF_READ_LIST,
    }),
    referenceDocPath: 'cross-refs/list.mdx',
    referenceGroup: 'crossRefs',
  },
  'crossRefs.get': {
    memberPath: 'crossRefs.get',
    description: 'Get detailed information about a specific cross-reference field.',
    expectedResult: "Returns a CrossRefInfo object with the cross-reference's target, display, and resolved text.",
    requiresDocumentContext: true,
    metadata: readOperation({
      throws: T_NOT_FOUND_CAPABLE,
    }),
    referenceDocPath: 'cross-refs/get.mdx',
    referenceGroup: 'crossRefs',
  },
  'crossRefs.insert': {
    memberPath: 'crossRefs.insert',
    description: 'Insert a new cross-reference field at a target location.',
    expectedResult:
      'Returns a CrossRefMutationResult indicating success with the cross-reference address or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['CAPABILITY_UNAVAILABLE'],
      throws: T_REF_INSERT,
    }),
    referenceDocPath: 'cross-refs/insert.mdx',
    referenceGroup: 'crossRefs',
  },
  'crossRefs.rebuild': {
    memberPath: 'crossRefs.rebuild',
    description: 'Rebuild (recalculate) a cross-reference field.',
    expectedResult: 'Returns a CrossRefMutationResult indicating success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['CAPABILITY_UNAVAILABLE'],
      throws: T_REF_MUTATION,
    }),
    referenceDocPath: 'cross-refs/rebuild.mdx',
    referenceGroup: 'crossRefs',
  },
  'crossRefs.remove': {
    memberPath: 'crossRefs.remove',
    description: 'Remove a cross-reference field from the document.',
    expectedResult: 'Returns a CrossRefMutationResult indicating success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_MUTATION_REMOVE,
    }),
    referenceDocPath: 'cross-refs/remove.mdx',
    referenceGroup: 'crossRefs',
  },
  // -------------------------------------------------------------------------
  // Index
  // -------------------------------------------------------------------------
  'index.list': {
    memberPath: 'index.list',
    description: 'List all index blocks in the document.',
    expectedResult: 'Returns an IndexListResult containing discovered index blocks with address and domain data.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: T_REF_READ_LIST,
    }),
    referenceDocPath: 'index/list.mdx',
    referenceGroup: 'index',
  },
  'index.get': {
    memberPath: 'index.get',
    description: 'Get detailed information about a specific index block.',
    expectedResult: "Returns an IndexInfo object with the index's instruction, configuration, and entry count.",
    requiresDocumentContext: true,
    metadata: readOperation({
      throws: T_NOT_FOUND_CAPABLE,
    }),
    referenceDocPath: 'index/get.mdx',
    referenceGroup: 'index',
  },
  'index.insert': {
    memberPath: 'index.insert',
    description: 'Insert a new index block at a target location.',
    expectedResult: 'Returns an IndexMutationResult indicating success with the index address or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_INSERT,
    }),
    referenceDocPath: 'index/insert.mdx',
    referenceGroup: 'index',
  },
  'index.configure': {
    memberPath: 'index.configure',
    description: 'Update the configuration of an existing index block.',
    expectedResult: 'Returns an IndexMutationResult indicating success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_MUTATION,
    }),
    referenceDocPath: 'index/configure.mdx',
    referenceGroup: 'index',
  },
  'index.rebuild': {
    memberPath: 'index.rebuild',
    description: 'Rebuild (regenerate) an index block from its entries.',
    expectedResult: 'Returns an IndexMutationResult indicating success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_MUTATION,
    }),
    referenceDocPath: 'index/rebuild.mdx',
    referenceGroup: 'index',
  },
  'index.remove': {
    memberPath: 'index.remove',
    description: 'Remove an index block from the document.',
    expectedResult: 'Returns an IndexMutationResult indicating success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_MUTATION_REMOVE,
    }),
    referenceDocPath: 'index/remove.mdx',
    referenceGroup: 'index',
  },
  // -------------------------------------------------------------------------
  // Index: XE entry management
  // -------------------------------------------------------------------------
  'index.entries.list': {
    memberPath: 'index.entries.list',
    description: 'List all XE (index entry) fields in the document.',
    expectedResult: 'Returns an IndexEntryListResult containing discovered index entries with address and domain data.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: T_REF_READ_LIST,
    }),
    referenceDocPath: 'index/entries-list.mdx',
    referenceGroup: 'index',
  },
  'index.entries.get': {
    memberPath: 'index.entries.get',
    description: 'Get detailed information about a specific XE index entry.',
    expectedResult: "Returns an IndexEntryInfo object with the entry's text, sub-entry, formatting, and instruction.",
    requiresDocumentContext: true,
    metadata: readOperation({
      throws: T_NOT_FOUND_CAPABLE,
    }),
    referenceDocPath: 'index/entries-get.mdx',
    referenceGroup: 'index',
  },
  'index.entries.insert': {
    memberPath: 'index.entries.insert',
    description: 'Insert a new XE index entry field at a target location.',
    expectedResult: 'Returns an IndexEntryMutationResult indicating success with the entry address or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_INSERT,
    }),
    referenceDocPath: 'index/entries-insert.mdx',
    referenceGroup: 'index',
  },
  'index.entries.update': {
    memberPath: 'index.entries.update',
    description: 'Update the properties of an existing XE index entry.',
    expectedResult: 'Returns an IndexEntryMutationResult indicating success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_MUTATION,
    }),
    referenceDocPath: 'index/entries-update.mdx',
    referenceGroup: 'index',
  },
  'index.entries.remove': {
    memberPath: 'index.entries.remove',
    description: 'Remove an XE index entry field from the document.',
    expectedResult: 'Returns an IndexEntryMutationResult indicating success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_MUTATION_REMOVE,
    }),
    referenceDocPath: 'index/entries-remove.mdx',
    referenceGroup: 'index',
  },
  // -------------------------------------------------------------------------
  // Captions
  // -------------------------------------------------------------------------
  'captions.list': {
    memberPath: 'captions.list',
    description: 'List all caption paragraphs in the document.',
    expectedResult: 'Returns a CaptionsListResult containing discovered captions with address and domain data.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: T_REF_READ_LIST,
    }),
    referenceDocPath: 'captions/list.mdx',
    referenceGroup: 'captions',
  },
  'captions.get': {
    memberPath: 'captions.get',
    description: 'Get detailed information about a specific caption paragraph.',
    expectedResult: "Returns a CaptionInfo object with the caption's label, number, text, and instruction.",
    requiresDocumentContext: true,
    metadata: readOperation({
      throws: T_NOT_FOUND_CAPABLE,
    }),
    referenceDocPath: 'captions/get.mdx',
    referenceGroup: 'captions',
  },
  'captions.insert': {
    memberPath: 'captions.insert',
    description: 'Insert a new caption paragraph adjacent to a target block.',
    expectedResult: 'Returns a CaptionMutationResult indicating success with the caption address or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_INSERT,
    }),
    referenceDocPath: 'captions/insert.mdx',
    referenceGroup: 'captions',
  },
  'captions.update': {
    memberPath: 'captions.update',
    description: 'Append patch text to an existing caption paragraph.',
    expectedResult:
      'Returns a CaptionMutationResult indicating success after appending patch.text to the existing caption body, or NO_OP when no text patch is provided.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_REF_MUTATION,
    }),
    referenceDocPath: 'captions/update.mdx',
    referenceGroup: 'captions',
  },
  'captions.remove': {
    memberPath: 'captions.remove',
    description: 'Remove a caption paragraph from the document.',
    expectedResult: 'Returns a CaptionMutationResult indicating success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_MUTATION_REMOVE,
    }),
    referenceDocPath: 'captions/remove.mdx',
    referenceGroup: 'captions',
  },
  'captions.configure': {
    memberPath: 'captions.configure',
    description: 'Configure numbering format for a caption label.',
    expectedResult: 'Returns a CaptionConfigResult indicating success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_MUTATION,
    }),
    referenceDocPath: 'captions/configure.mdx',
    referenceGroup: 'captions',
  },
  // -------------------------------------------------------------------------
  // Fields
  // -------------------------------------------------------------------------
  'fields.list': {
    memberPath: 'fields.list',
    description: 'List all fields in the document.',
    expectedResult: 'Returns a FieldsListResult containing discovered fields with address and domain data.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: T_REF_READ_LIST,
    }),
    referenceDocPath: 'fields/list.mdx',
    referenceGroup: 'fields',
  },
  'fields.get': {
    memberPath: 'fields.get',
    description: 'Get detailed information about a specific field.',
    expectedResult: "Returns a FieldInfo object with the field's instruction, result text, and nesting data.",
    requiresDocumentContext: true,
    metadata: readOperation({
      throws: T_NOT_FOUND_CAPABLE,
    }),
    referenceDocPath: 'fields/get.mdx',
    referenceGroup: 'fields',
  },
  'fields.insert': {
    memberPath: 'fields.insert',
    description: `Insert a raw field code at a target location, optionally preserving cached result text.${FIELD_PRESERVE_CACHED_V1_NOTE}`,
    expectedResult: 'Returns a FieldMutationResult indicating success with the field address or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_INSERT,
    }),
    referenceDocPath: 'fields/insert.mdx',
    referenceGroup: 'fields',
  },
  'fields.rebuild': {
    memberPath: 'fields.rebuild',
    description: 'Rebuild (recalculate) a field.',
    expectedResult: 'Returns a FieldMutationResult indicating success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_MUTATION,
    }),
    referenceDocPath: 'fields/rebuild.mdx',
    referenceGroup: 'fields',
  },
  'fields.remove': {
    memberPath: 'fields.remove',
    description: 'Remove a field from the document.',
    expectedResult: 'Returns a FieldMutationResult indicating success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_MUTATION_REMOVE,
    }),
    referenceDocPath: 'fields/remove.mdx',
    referenceGroup: 'fields',
  },
  // -------------------------------------------------------------------------
  // Citations
  // -------------------------------------------------------------------------
  'citations.list': {
    memberPath: 'citations.list',
    description: 'List all citation marks in the document.',
    expectedResult: 'Returns a CitationsListResult containing discovered citation marks with address and domain data.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: T_REF_READ_LIST,
    }),
    referenceDocPath: 'citations/list.mdx',
    referenceGroup: 'citations',
  },
  'citations.get': {
    memberPath: 'citations.get',
    description: 'Get detailed information about a specific citation mark.',
    expectedResult: "Returns a CitationInfo object with the citation's source references and display text.",
    requiresDocumentContext: true,
    metadata: readOperation({
      throws: T_NOT_FOUND_CAPABLE,
    }),
    referenceDocPath: 'citations/get.mdx',
    referenceGroup: 'citations',
  },
  'citations.insert': {
    memberPath: 'citations.insert',
    description: 'Insert a new citation mark at a target location.',
    expectedResult: 'Returns a CitationMutationResult indicating success with the citation address or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_INSERT,
    }),
    referenceDocPath: 'citations/insert.mdx',
    referenceGroup: 'citations',
  },
  'citations.update': {
    memberPath: 'citations.update',
    description: "Update an existing citation mark's source references.",
    expectedResult: 'Returns a CitationMutationResult indicating success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_MUTATION,
    }),
    referenceDocPath: 'citations/update.mdx',
    referenceGroup: 'citations',
  },
  'citations.remove': {
    memberPath: 'citations.remove',
    description: 'Remove a citation mark from the document.',
    expectedResult: 'Returns a CitationMutationResult indicating success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_MUTATION_REMOVE,
    }),
    referenceDocPath: 'citations/remove.mdx',
    referenceGroup: 'citations',
  },
  // -------------------------------------------------------------------------
  // Citations: sources
  // -------------------------------------------------------------------------
  'citations.sources.list': {
    memberPath: 'citations.sources.list',
    description: 'List all citation sources in the document store.',
    expectedResult: 'Returns a CitationSourcesListResult containing discovered sources with address and domain data.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: T_REF_READ_LIST,
    }),
    referenceDocPath: 'citations/sources-list.mdx',
    referenceGroup: 'citations',
  },
  'citations.sources.get': {
    memberPath: 'citations.sources.get',
    description: 'Get detailed information about a specific citation source.',
    expectedResult: "Returns a CitationSourceInfo object with the source's type, fields, and metadata.",
    requiresDocumentContext: true,
    metadata: readOperation({
      throws: T_NOT_FOUND_CAPABLE,
    }),
    referenceDocPath: 'citations/sources-get.mdx',
    referenceGroup: 'citations',
  },
  'citations.sources.insert': {
    memberPath: 'citations.sources.insert',
    description: 'Register a new citation source in the document store.',
    expectedResult: 'Returns a CitationSourceMutationResult indicating success with the source address or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_INSERT,
    }),
    referenceDocPath: 'citations/sources-insert.mdx',
    referenceGroup: 'citations',
  },
  'citations.sources.update': {
    memberPath: 'citations.sources.update',
    description: 'Update the fields of an existing citation source.',
    expectedResult: 'Returns a CitationSourceMutationResult indicating success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_MUTATION,
    }),
    referenceDocPath: 'citations/sources-update.mdx',
    referenceGroup: 'citations',
  },
  'citations.sources.remove': {
    memberPath: 'citations.sources.remove',
    description: 'Remove a citation source from the document store.',
    expectedResult: 'Returns a CitationSourceMutationResult indicating success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_MUTATION_REMOVE,
    }),
    referenceDocPath: 'citations/sources-remove.mdx',
    referenceGroup: 'citations',
  },
  // -------------------------------------------------------------------------
  // Citations: bibliography
  // -------------------------------------------------------------------------
  'citations.bibliography.get': {
    memberPath: 'citations.bibliography.get',
    description: 'Get information about the bibliography block.',
    expectedResult: "Returns a BibliographyInfo object with the bibliography's address and configuration.",
    requiresDocumentContext: true,
    metadata: readOperation({
      throws: T_NOT_FOUND_CAPABLE,
    }),
    referenceDocPath: 'citations/bibliography-get.mdx',
    referenceGroup: 'citations',
  },
  'citations.bibliography.insert': {
    memberPath: 'citations.bibliography.insert',
    description: 'Insert a bibliography block at a target location.',
    expectedResult:
      'Returns a BibliographyMutationResult indicating success with the bibliography address or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_INSERT,
    }),
    referenceDocPath: 'citations/bibliography-insert.mdx',
    referenceGroup: 'citations',
  },
  'citations.bibliography.rebuild': {
    memberPath: 'citations.bibliography.rebuild',
    description: 'Rebuild the bibliography from current sources.',
    expectedResult: 'Returns a BibliographyMutationResult indicating success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_MUTATION,
    }),
    referenceDocPath: 'citations/bibliography-rebuild.mdx',
    referenceGroup: 'citations',
  },
  'citations.bibliography.configure': {
    memberPath: 'citations.bibliography.configure',
    description: 'Configure the bibliography style.',
    expectedResult: 'Returns a BibliographyMutationResult indicating success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_MUTATION,
    }),
    referenceDocPath: 'citations/bibliography-configure.mdx',
    referenceGroup: 'citations',
  },
  'citations.bibliography.remove': {
    memberPath: 'citations.bibliography.remove',
    description: 'Remove the bibliography block from the document.',
    expectedResult: 'Returns a BibliographyMutationResult indicating success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_MUTATION_REMOVE,
    }),
    referenceDocPath: 'citations/bibliography-remove.mdx',
    referenceGroup: 'citations',
  },
  // -------------------------------------------------------------------------
  // Authorities
  // -------------------------------------------------------------------------
  'authorities.list': {
    memberPath: 'authorities.list',
    description: 'List all table-of-authorities blocks in the document.',
    expectedResult: 'Returns an AuthoritiesListResult containing discovered TOA blocks with address and domain data.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: T_REF_READ_LIST,
    }),
    referenceDocPath: 'authorities/list.mdx',
    referenceGroup: 'authorities',
  },
  'authorities.get': {
    memberPath: 'authorities.get',
    description: 'Get detailed information about a specific table-of-authorities block.',
    expectedResult: "Returns an AuthoritiesInfo object with the TOA's category filter and configuration.",
    requiresDocumentContext: true,
    metadata: readOperation({
      throws: T_NOT_FOUND_CAPABLE,
    }),
    referenceDocPath: 'authorities/get.mdx',
    referenceGroup: 'authorities',
  },
  'authorities.insert': {
    memberPath: 'authorities.insert',
    description: 'Insert a new table-of-authorities block at a target location.',
    expectedResult: 'Returns an AuthoritiesMutationResult indicating success with the TOA address or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_INSERT,
    }),
    referenceDocPath: 'authorities/insert.mdx',
    referenceGroup: 'authorities',
  },
  'authorities.configure': {
    memberPath: 'authorities.configure',
    description: 'Update the configuration of an existing table-of-authorities block.',
    expectedResult: 'Returns an AuthoritiesMutationResult indicating success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_MUTATION,
    }),
    referenceDocPath: 'authorities/configure.mdx',
    referenceGroup: 'authorities',
  },
  'authorities.rebuild': {
    memberPath: 'authorities.rebuild',
    description: 'Rebuild a table-of-authorities block from its entries.',
    expectedResult: 'Returns an AuthoritiesMutationResult indicating success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_MUTATION,
    }),
    referenceDocPath: 'authorities/rebuild.mdx',
    referenceGroup: 'authorities',
  },
  'authorities.remove': {
    memberPath: 'authorities.remove',
    description: 'Remove a table-of-authorities block from the document.',
    expectedResult: 'Returns an AuthoritiesMutationResult indicating success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_MUTATION_REMOVE,
    }),
    referenceDocPath: 'authorities/remove.mdx',
    referenceGroup: 'authorities',
  },
  // -------------------------------------------------------------------------
  // Authorities: TA entry management
  // -------------------------------------------------------------------------
  'authorities.entries.list': {
    memberPath: 'authorities.entries.list',
    description: 'List all TA (authority entry) fields in the document.',
    expectedResult: 'Returns an AuthorityEntryListResult containing discovered entries with address and domain data.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: T_REF_READ_LIST,
    }),
    referenceDocPath: 'authorities/entries-list.mdx',
    referenceGroup: 'authorities',
  },
  'authorities.entries.get': {
    memberPath: 'authorities.entries.get',
    description: 'Get detailed information about a specific TA authority entry.',
    expectedResult: "Returns an AuthorityEntryInfo object with the entry's citations and category.",
    requiresDocumentContext: true,
    metadata: readOperation({
      throws: T_NOT_FOUND_CAPABLE,
    }),
    referenceDocPath: 'authorities/entries-get.mdx',
    referenceGroup: 'authorities',
  },
  'authorities.entries.insert': {
    memberPath: 'authorities.entries.insert',
    description: 'Insert a new TA authority entry field at a target location.',
    expectedResult: 'Returns an AuthorityEntryMutationResult indicating success with the entry address or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_INSERT,
    }),
    referenceDocPath: 'authorities/entries-insert.mdx',
    referenceGroup: 'authorities',
  },
  'authorities.entries.update': {
    memberPath: 'authorities.entries.update',
    description: 'Update the properties of an existing TA authority entry.',
    expectedResult: 'Returns an AuthorityEntryMutationResult indicating success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_MUTATION,
    }),
    referenceDocPath: 'authorities/entries-update.mdx',
    referenceGroup: 'authorities',
  },
  'authorities.entries.remove': {
    memberPath: 'authorities.entries.remove',
    description: 'Remove a TA authority entry field from the document.',
    expectedResult: 'Returns an AuthorityEntryMutationResult indicating success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_REF_MUTATION_REMOVE,
    }),
    referenceDocPath: 'authorities/entries-remove.mdx',
    referenceGroup: 'authorities',
  },
  // ---------------------------------------------------------------------------
  // diff.*
  // ---------------------------------------------------------------------------
  'diff.capture': {
    memberPath: 'diff.capture',
    description:
      "Capture the current document's diffable state as a versioned snapshot. " +
      'v2 capture requires source-complete state and reports coverage for body, comments, styles, numbering, and header/footers, ' +
      'with extended family coverage carried in the opaque payload. Legacy body-only v2 artifacts remain accepted for compare/apply compatibility.',
    expectedResult: 'Returns a DiffSnapshot with a fingerprint and opaque payload.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: ['PRECONDITION_FAILED'],
    }),
    referenceDocPath: 'diff/capture.mdx',
    referenceGroup: 'diff',
    skipAsATool: true,
  },
  'diff.compare': {
    memberPath: 'diff.compare',
    description:
      'Compare the current document (base) against a previously captured target snapshot. ' +
      'Returns a versioned diff payload whose summary reports which components changed: ' +
      'body, comments, styles, numbering, header/footers, and parts.',
    expectedResult: 'Returns a DiffPayload with a summary and opaque payload.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: ['INVALID_INPUT', 'CAPABILITY_UNSUPPORTED'],
    }),
    referenceDocPath: 'diff/compare.mdx',
    referenceGroup: 'diff',
    skipAsATool: true,
  },
  'diff.apply': {
    memberPath: 'diff.apply',
    description:
      'Apply a previously computed diff payload to the current document. ' +
      'The document fingerprint must match the diff base fingerprint. ' +
      'Omitted changeMode applies story content directly; explicit tracked mode governs all four story families (body, header/footer parts, footnotes, endnotes). Comments, styles, and numbering are always applied directly. ' +
      'Supported mixed full-diff payloads apply atomically across body, comments, styles, numbering, and header/footers. ' +
      'Unsupported/deferred families such as package-graph/media/hyperlink closure, settings/theme, and textboxes fail closed before mutation.',
    expectedResult:
      'Returns a DiffApplyResult with per-operation review receipts, applied operation count, and diagnostics.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'conditional',
      supportsDryRun: false,
      supportsTrackedMode: true,
      possibleFailureCodes: NONE_FAILURES,
      throws: ['INVALID_INPUT', 'CAPABILITY_UNSUPPORTED', 'PRECONDITION_FAILED', 'CAPABILITY_UNAVAILABLE'],
      historyUnsafe: true,
    }),
    referenceDocPath: 'diff/apply.mdx',
    referenceGroup: 'diff',
    skipAsATool: true,
  },
  // =========================================================================
  // export.*
  // =========================================================================
  'export.toDocx': {
    memberPath: 'export.toDocx',
    description:
      'Serialize the current document to DOCX bytes under an explicit tracked-change export mode. ' +
      '`review-preserving` (default) keeps open tracked changes as Word revision markup, `final` resolves ' +
      'them as accepted, and `original` resolves them as rejected. Returns the exported bytes plus a ' +
      'structured degradation report of allowed warnings. An invalid mode fails closed with INVALID_INPUT ' +
      'before any work happens.',
    expectedResult:
      'Returns an ExportToDocxResult with the resolved mode, base64 DOCX bytes, byte length, and a report.warnings array.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: ['INVALID_INPUT', 'CAPABILITY_UNSUPPORTED'],
    }),
    referenceDocPath: 'export/to-docx.mdx',
    referenceGroup: 'export',
    skipAsATool: true,
  },
  // =========================================================================
  // protection.*
  // =========================================================================
  'protection.get': {
    memberPath: 'protection.get',
    description:
      'Read the current document protection state including editing restrictions, write protection, and read-only recommendation.',
    expectedResult:
      'Returns a DocumentProtectionState with editingRestriction, writeProtection, and readOnlyRecommended fields.',
    requiresDocumentContext: true,
    metadata: readOperation({ throws: T_PROTECTION_READ }),
    referenceDocPath: 'protection/get.mdx',
    referenceGroup: 'protection',
    skipAsATool: true,
  },
  'protection.setEditingRestriction': {
    memberPath: 'protection.setEditingRestriction',
    description: 'Enable Word-style editing restriction on the document. Only readOnly mode is supported in v1.',
    expectedResult: 'Returns a ProtectionMutationResult with the updated protection state on success.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_PROTECTION_MUTATION,
    }),
    referenceDocPath: 'protection/set-editing-restriction.mdx',
    referenceGroup: 'protection',
    skipAsATool: true,
  },
  'protection.clearEditingRestriction': {
    memberPath: 'protection.clearEditingRestriction',
    description:
      'Disable document-level editing restriction by setting enforcement to off. Preserves the protection element and its metadata for round-trip fidelity.',
    expectedResult: 'Returns a ProtectionMutationResult with the updated protection state on success.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['NO_OP'],
      throws: T_PROTECTION_MUTATION,
    }),
    referenceDocPath: 'protection/clear-editing-restriction.mdx',
    referenceGroup: 'protection',
    skipAsATool: true,
  },
  // =========================================================================
  // permissionRanges.*
  // =========================================================================
  'permissionRanges.list': {
    memberPath: 'permissionRanges.list',
    description:
      'List all permission ranges in the document. Returns only complete paired ranges (both start and end markers present).',
    expectedResult:
      'Returns a PermissionRangesListResult containing discovered permission ranges with principal and position data.',
    requiresDocumentContext: true,
    metadata: readOperation({ throws: T_PERM_RANGE_READ }),
    referenceDocPath: 'permission-ranges/list.mdx',
    referenceGroup: 'permissionRanges',
    skipAsATool: true,
  },
  'permissionRanges.get': {
    memberPath: 'permissionRanges.get',
    description: 'Get detailed information about a specific permission range by ID.',
    expectedResult: 'Returns a PermissionRangeInfo object with the range principal, kind, and positions.',
    requiresDocumentContext: true,
    metadata: readOperation({ throws: T_PERM_RANGE_READ }),
    referenceDocPath: 'permission-ranges/get.mdx',
    referenceGroup: 'permissionRanges',
    skipAsATool: true,
  },
  'permissionRanges.create': {
    memberPath: 'permissionRanges.create',
    description:
      'Create a permission range exception region in the document. Inserts matched permStart/permEnd markers at the target.',
    expectedResult: 'Returns a PermissionRangeMutationResult with the created range info on success.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_PERM_RANGE_MUTATION,
    }),
    referenceDocPath: 'permission-ranges/create.mdx',
    referenceGroup: 'permissionRanges',
    skipAsATool: true,
  },
  'permissionRanges.remove': {
    memberPath: 'permissionRanges.remove',
    description:
      'Remove a permission range by ID. Removes whichever markers exist for the given ID (start, end, or both).',
    expectedResult: 'Returns a PermissionRangeRemoveResult indicating success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_PERM_RANGE_MUTATION,
    }),
    referenceDocPath: 'permission-ranges/remove.mdx',
    referenceGroup: 'permissionRanges',
    skipAsATool: true,
  },
  'permissionRanges.updatePrincipal': {
    memberPath: 'permissionRanges.updatePrincipal',
    description:
      'Change which principal is allowed to edit a permission range. Updates the principal fields on the start marker.',
    expectedResult: 'Returns a PermissionRangeMutationResult with the updated range info on success.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: NONE_FAILURES,
      throws: T_PERM_RANGE_MUTATION,
    }),
    referenceDocPath: 'permission-ranges/update-principal.mdx',
    referenceGroup: 'permissionRanges',
    skipAsATool: true,
  },
  // -------------------------------------------------------------------------
  // Custom XML Parts (ECMA-376 Part 1 §15.2.5, §15.2.6, §22.5)
  // -------------------------------------------------------------------------
  'customXml.parts.list': {
    memberPath: 'customXml.parts.list',
    description:
      'List Custom XML Data Storage Parts in the document, optionally filtered by root namespace or schema reference.',
    expectedResult: 'Returns a CustomXmlPartsListResult with summary entries (no content); fetch content via get.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: T_REF_READ_LIST,
    }),
    referenceDocPath: 'custom-xml/parts/list.mdx',
    referenceGroup: 'customXml',
  },
  'customXml.parts.get': {
    memberPath: 'customXml.parts.get',
    description:
      'Get a single Custom XML Data Storage Part by itemID or package part name, including its full content. ' +
      'v1 partName targeting is limited to Word-style customXml/itemN.xml paths.',
    expectedResult:
      'Returns a CustomXmlPartInfo with id, partName, namespaces, schemaRefs, and content; or null if not found.',
    requiresDocumentContext: true,
    metadata: readOperation({
      throws: T_NOT_FOUND_CAPABLE,
    }),
    referenceDocPath: 'custom-xml/parts/get.mdx',
    referenceGroup: 'customXml',
  },
  'customXml.parts.create': {
    memberPath: 'customXml.parts.create',
    description:
      'Add a new Custom XML Data Storage Part to the document. Generates a fresh itemID GUID and emits the Properties Part.',
    expectedResult: 'Returns a CustomXmlPartsCreateResult with the generated id and package part names on success.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['INVALID_INPUT'],
      throws: T_REF_INSERT,
    }),
    referenceDocPath: 'custom-xml/parts/create.mdx',
    referenceGroup: 'customXml',
  },
  'customXml.parts.patch': {
    memberPath: 'customXml.parts.patch',
    description:
      'Replace the content and/or schemaRefs of an existing Custom XML Data Storage Part. ' +
      'At least one of content or schemaRefs is required. ' +
      'v1 partName targeting is limited to Word-style customXml/itemN.xml paths.',
    expectedResult: 'Returns a CustomXmlPartsMutationResult indicating success with the resolved target or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['TARGET_NOT_FOUND', 'INVALID_INPUT'],
      throws: T_REF_MUTATION,
    }),
    referenceDocPath: 'custom-xml/parts/patch.mdx',
    referenceGroup: 'customXml',
  },
  'customXml.parts.remove': {
    memberPath: 'customXml.parts.remove',
    description:
      'Remove a Custom XML Data Storage Part and clean up all linked package files (item, props, rels, content-types entry). ' +
      'v1 partName targeting is limited to Word-style customXml/itemN.xml paths.',
    expectedResult: 'Returns a CustomXmlPartsMutationResult indicating success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['TARGET_NOT_FOUND'],
      throws: T_REF_MUTATION_REMOVE,
    }),
    referenceDocPath: 'custom-xml/parts/remove.mdx',
    referenceGroup: 'customXml',
  },
  // -------------------------------------------------------------------------
  // Anchored metadata (composition over customXml.parts + contentControls)
  // -------------------------------------------------------------------------
  'metadata.attach': {
    memberPath: 'metadata.attach',
    description:
      'Anchor a JSON metadata payload to a span of text. ' +
      'Wraps the target range in a hidden inline content control whose w:tag carries a stable id, and stores the payload in a namespaced Custom XML Data Storage Part. ' +
      'v1 supports text-range anchors only.',
    expectedResult:
      'Returns an AnchoredMetadataAttachResult with the assigned id and the backing Storage Part name on success.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['TARGET_NOT_FOUND', 'INVALID_TARGET', 'INVALID_INPUT'],
      throws: [...T_REF_INSERT, 'REVISION_MISMATCH'],
    }),
    referenceDocPath: 'metadata/attach.mdx',
    referenceGroup: 'metadata',
  },
  'metadata.list': {
    memberPath: 'metadata.list',
    description:
      'List anchored-metadata entries in the document, optionally filtered by consumer namespace and/or a `within` selection (returns only entries whose anchor overlaps `within`).',
    expectedResult: 'Returns an AnchoredMetadataListResult with summary entries (no payload); fetch payload via get.',
    requiresDocumentContext: true,
    metadata: readOperation({
      idempotency: 'idempotent',
      throws: T_REF_READ_LIST,
    }),
    referenceDocPath: 'metadata/list.mdx',
    referenceGroup: 'metadata',
  },
  'metadata.get': {
    memberPath: 'metadata.get',
    description: 'Get a single anchored-metadata entry by id, including its JSON payload.',
    expectedResult: 'Returns an AnchoredMetadataInfo with id, namespace, partName, and payload; or null if not found.',
    requiresDocumentContext: true,
    metadata: readOperation({
      throws: T_NOT_FOUND_CAPABLE,
    }),
    referenceDocPath: 'metadata/get.mdx',
    referenceGroup: 'metadata',
  },
  'metadata.update': {
    memberPath: 'metadata.update',
    description:
      'Replace the JSON payload of an existing anchored-metadata entry. Replace semantics; no merge. The anchor is left untouched.',
    expectedResult: 'Returns an AnchoredMetadataMutationResult with the entry id on success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['TARGET_NOT_FOUND', 'INVALID_INPUT'],
      throws: [...T_REF_MUTATION, 'REVISION_MISMATCH'],
    }),
    referenceDocPath: 'metadata/update.mdx',
    referenceGroup: 'metadata',
  },
  'metadata.remove': {
    memberPath: 'metadata.remove',
    description:
      'Remove an anchored-metadata entry. Strips the anchor content-control wrapper (its content stays in the document) and deletes the payload entry from the Storage Part. In v1 these writes are sequenced, not transactional: the adapter resolves the target up-front so missing-target failures land before any state change, but a crash strictly between the two writes can leave a dangling payload. When the backing part has no remaining entries, the part itself is removed.',
    expectedResult: 'Returns an AnchoredMetadataMutationResult with the removed entry id on success or a failure.',
    requiresDocumentContext: true,
    metadata: mutationOperation({
      idempotency: 'non-idempotent',
      supportsDryRun: true,
      supportsTrackedMode: false,
      possibleFailureCodes: ['TARGET_NOT_FOUND'],
      throws: [...T_REF_MUTATION_REMOVE, 'REVISION_MISMATCH'],
    }),
    referenceDocPath: 'metadata/remove.mdx',
    referenceGroup: 'metadata',
  },
  'metadata.resolve': {
    memberPath: 'metadata.resolve',
    description:
      'Find where an anchored-metadata entry is anchored in the document. Returns the SelectionTarget covering the anchor content.',
    expectedResult:
      'Returns an AnchoredMetadataResolveInfo with id and target SelectionTarget; or null if the anchor is no longer present.',
    requiresDocumentContext: true,
    metadata: readOperation({
      throws: T_NOT_FOUND_CAPABLE,
    }),
    referenceDocPath: 'metadata/resolve.mdx',
    referenceGroup: 'metadata',
  },
} as const satisfies Record<string, OperationDefinitionEntry>;
// ---------------------------------------------------------------------------
// Derived identities (immutable)
// ---------------------------------------------------------------------------
export type OperationId = keyof typeof OPERATION_DEFINITIONS;
export const OPERATION_IDS: readonly OperationId[] = Object.freeze(Object.keys(OPERATION_DEFINITIONS) as OperationId[]);
export const SINGLETON_OPERATION_IDS: readonly OperationId[] = Object.freeze(
  OPERATION_IDS.filter((id) => !id.includes('.')),
);
export const NAMESPACED_OPERATION_IDS: readonly OperationId[] = Object.freeze(
  OPERATION_IDS.filter((id) => id.includes('.')),
);
// ---------------------------------------------------------------------------
// Typed projection helper (single contained cast)
// ---------------------------------------------------------------------------
/**
 * Projects a value from each operation definition entry into a keyed record.
 *
 * The cast is needed because `Object.fromEntries` returns `Record<string, V>`;
 * all callers validate the result via explicit type annotations.
 */
export function projectFromDefinitions<V>(
  fn: (id: OperationId, entry: OperationDefinitionEntry) => V,
): Record<OperationId, V> {
  return Object.fromEntries(OPERATION_IDS.map((id) => [id, fn(id, OPERATION_DEFINITIONS[id])])) as Record<
    OperationId,
    V
  >;
}
