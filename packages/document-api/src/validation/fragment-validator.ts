/**
 * Fragment validation: validates structural content before materialization.
 *
 * Handles BOTH SDM/1 shapes (kind-discriminated) and legacy shapes (type-discriminated).
 * SDM/1 validation uses SDErrorCode vocabulary (INVALID_PAYLOAD, DUPLICATE_ID, etc.).
 * Legacy validation uses legacy codes (INVALID_FRAGMENT, EMPTY_FRAGMENT) for backward compat.
 *
 * Validation tree (SDM/1 path):
 *   validateSDFragment(fragment)
 *     ├── normalize to array, reject if empty → INVALID_PAYLOAD
 *     ├── for each node:
 *     │   ├── assertPlainObject → INVALID_PAYLOAD
 *     │   ├── validateKindField → INVALID_PAYLOAD
 *     │   ├── validatePayloadKeyMatchesKind → INVALID_PAYLOAD
 *     │   ├── validateContentNodeKind → INVALID_PAYLOAD
 *     │   └── validateNodeContent (dispatches by kind)
 *     └── validateUniqueIds → DUPLICATE_ID
 */

import type { SDFragment } from '../types/fragment.js';
import { SD_CONTENT_NODE_KINDS, SD_INLINE_NODE_KINDS } from '../types/fragment.js';
import { DocumentApiValidationError } from '../errors.js';
import { isRecord } from '../validation-primitives.js';

// ---------------------------------------------------------------------------
// Kind sets
// ---------------------------------------------------------------------------

const CONTENT_KIND_SET: ReadonlySet<string> = new Set(SD_CONTENT_NODE_KINDS);
const INLINE_KIND_SET: ReadonlySet<string> = new Set(SD_INLINE_NODE_KINDS);

/** Legacy top-level types (for backward-compatible validation of type-discriminated shapes). */
const LEGACY_TOP_LEVEL_TYPES: ReadonlySet<string> = new Set([
  'paragraph',
  'heading',
  'table',
  'image',
  'list',
  'sectionBreak',
  'tableOfContents',
  'sdt',
]);

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Validates an SDM/1 fragment for structural correctness.
 *
 * Uses SDErrorCode vocabulary for all error codes.
 */
export function validateSDFragment(fragment: unknown): asserts fragment is SDFragment {
  const nodes = normalizeToNodeArray(fragment, 'INVALID_PAYLOAD');

  const seenIds: Set<string> = new Set();

  for (const node of nodes) {
    validateContentNode(node, seenIds);
  }
}

/**
 * Backward-compatible entry point: validates both legacy and SDM/1 shapes.
 *
 * Routes to SDM/1 or legacy validation based on the presence of `kind` vs `type`.
 */
export function validateDocumentFragment(fragment: unknown): asserts fragment is SDFragment {
  if (fragment === null || fragment === undefined) {
    throw new DocumentApiValidationError('INVALID_PAYLOAD', 'Fragment must not be null or undefined.');
  }

  const nodes = Array.isArray(fragment) ? fragment : [fragment];
  if (nodes.length === 0) {
    throw new DocumentApiValidationError('INVALID_PAYLOAD', 'Fragment must contain at least one node.');
  }

  // Detect shape by checking the first node's discriminant
  const first = nodes[0];
  if (isRecord(first) && typeof (first as Record<string, unknown>).kind === 'string') {
    // SDM/1 path: delegate to full SDM/1 validator
    validateSDFragment(fragment);
    return;
  }

  // Legacy path: validate type-discriminated shapes
  for (const node of nodes) {
    validateLegacyTopLevelNode(node);
  }
}

// ---------------------------------------------------------------------------
// SDM/1 validation: content nodes
// ---------------------------------------------------------------------------

function normalizeToNodeArray(fragment: unknown, errorCode: string): unknown[] {
  if (fragment === null || fragment === undefined) {
    throw new DocumentApiValidationError(errorCode, 'Fragment must not be null or undefined.');
  }
  const nodes = Array.isArray(fragment) ? fragment : [fragment];
  if (nodes.length === 0) {
    throw new DocumentApiValidationError(errorCode, 'Fragment must contain at least one node.');
  }
  return nodes;
}

function validateContentNode(node: unknown, seenIds: Set<string>): void {
  assertPlainObject(node);

  const rec = node as Record<string, unknown>;
  const kind = assertKindField(rec);

  // Rule 9: Unknown kinds only via ext.*
  if (!CONTENT_KIND_SET.has(kind) && !kind.startsWith('ext.')) {
    throw new DocumentApiValidationError('INVALID_PAYLOAD', `"${kind}" is not a valid content node kind.`, { kind });
  }

  // Rule 2: kind must match exactly one payload key
  validatePayloadKeyMatchesKind(rec, kind);

  // Rule 3: IDs must be unique when provided
  collectAndCheckId(rec, seenIds);

  // Dispatch kind-specific content validation
  validateContentByKind(rec, kind, seenIds);
}

// ---------------------------------------------------------------------------
// Shape assertions
// ---------------------------------------------------------------------------

function assertPlainObject(node: unknown): void {
  if (!isRecord(node)) {
    throw new DocumentApiValidationError('INVALID_PAYLOAD', 'Each node in a fragment must be a plain object.');
  }
}

function assertKindField(rec: Record<string, unknown>): string {
  if (typeof rec.kind !== 'string' || rec.kind.length === 0) {
    throw new DocumentApiValidationError(
      'INVALID_PAYLOAD',
      'Each content node must have a non-empty string "kind" field.',
    );
  }
  return rec.kind;
}

/** Rule 2: the node must have a payload key matching its kind. */
function validatePayloadKeyMatchesKind(rec: Record<string, unknown>, kind: string): void {
  // Extension nodes don't require a matching payload key
  if (kind.startsWith('ext.')) return;

  // Certain "marker" kinds have no required payload (break, tab, lineBreak, etc.)
  const markerKinds: ReadonlySet<string> = new Set([
    'break',
    'sectionBreak',
    'tab',
    'lineBreak',
    'footnoteRef',
    'endnoteRef',
  ]);
  if (markerKinds.has(kind)) return;

  if (!(kind in rec)) {
    throw new DocumentApiValidationError(
      'INVALID_PAYLOAD',
      `Node with kind "${kind}" must have a "${kind}" payload key.`,
      { kind },
    );
  }

  if (rec[kind] !== undefined && !isRecord(rec[kind])) {
    throw new DocumentApiValidationError('INVALID_PAYLOAD', `"${kind}" payload must be an object.`, { kind });
  }
}

// ---------------------------------------------------------------------------
// Rule 3: unique IDs
// ---------------------------------------------------------------------------

function collectAndCheckId(rec: Record<string, unknown>, seenIds: Set<string>): void {
  const id = rec.id;
  if (typeof id !== 'string') return;

  if (seenIds.has(id)) {
    throw new DocumentApiValidationError('DUPLICATE_ID', `Duplicate node ID "${id}" in fragment.`, { id });
  }
  seenIds.add(id);
}

// ---------------------------------------------------------------------------
// Kind-specific validation dispatch
// ---------------------------------------------------------------------------

function validateContentByKind(rec: Record<string, unknown>, kind: string, seenIds: Set<string>): void {
  switch (kind) {
    case 'paragraph':
      validateParagraphPayload(rec, seenIds);
      break;
    case 'heading':
      validateHeadingPayload(rec, seenIds);
      break;
    case 'table':
      validateTablePayload(rec, seenIds);
      break;
    case 'horizontalRule':
      validateHorizontalRule(rec);
      break;
    case 'list':
      validateListPayload(rec, seenIds);
      break;
    case 'image':
      validateImagePayload(rec);
      break;
    case 'sdt':
    case 'customXml':
      validateSdtPayload(rec, kind, seenIds);
      break;
    case 'toc':
      validateTocPayload(rec);
      break;
    case 'sectionBreak':
      validateSectionBreakPayload(rec);
      break;
  }
}

// ---------------------------------------------------------------------------
// Paragraph / heading
// ---------------------------------------------------------------------------

function validateParagraphPayload(rec: Record<string, unknown>, seenIds: Set<string>): void {
  const payload = rec.paragraph as Record<string, unknown> | undefined;
  if (!payload) return;

  // Rule 13: paragraph.numbering.level must be 0..8
  if (payload.numbering != null && isRecord(payload.numbering)) {
    const numbering = payload.numbering as Record<string, unknown>;
    if (typeof numbering.level === 'number') {
      const level = numbering.level;
      if (!Number.isInteger(level) || level < 0 || level > 8) {
        throw new DocumentApiValidationError(
          'INVALID_PAYLOAD',
          `paragraph.numbering.level must be an integer 0–8, got ${level}.`,
          { field: 'numbering.level' },
        );
      }
    }
  }

  // Rule 14: paragraph.tabs[*].position must be positive
  if (Array.isArray(payload.tabs)) {
    for (const tab of payload.tabs as unknown[]) {
      if (isRecord(tab)) {
        const pos = (tab as Record<string, unknown>).position;
        if (typeof pos === 'number' && pos <= 0) {
          throw new DocumentApiValidationError(
            'INVALID_PAYLOAD',
            `paragraph.tabs position must be positive, got ${pos}.`,
            { field: 'tabs.position' },
          );
        }
      }
    }
  }

  // Rule 4: inline arrays must be valid
  if (payload.inlines !== undefined) {
    validateInlinesArray(payload.inlines, 'paragraph', seenIds);
  }
}

function validateHeadingPayload(rec: Record<string, unknown>, seenIds: Set<string>): void {
  const payload = rec.heading as Record<string, unknown> | undefined;
  if (!payload) {
    throw new DocumentApiValidationError('INVALID_PAYLOAD', 'heading payload must be an object.');
  }

  // Rule 5: heading level must be 1–9
  const level = payload.level;
  if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 9) {
    throw new DocumentApiValidationError(
      'INVALID_PAYLOAD',
      `Heading level must be an integer between 1 and 9, got ${JSON.stringify(level)}.`,
      { field: 'level' },
    );
  }

  // Rule 4: inline arrays must be valid
  if (payload.inlines !== undefined) {
    validateInlinesArray(payload.inlines, 'heading', seenIds);
  }
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function validateTablePayload(rec: Record<string, unknown>, seenIds: Set<string>): void {
  const payload = rec.table as Record<string, unknown> | undefined;
  if (!payload) {
    throw new DocumentApiValidationError('INVALID_PAYLOAD', 'table payload must be an object.');
  }

  if (!Array.isArray(payload.rows) || payload.rows.length === 0) {
    throw new DocumentApiValidationError('INVALID_PAYLOAD', 'Table must have at least one row.', { field: 'rows' });
  }

  for (const row of payload.rows as unknown[]) {
    assertPlainObject(row);
    const rowRec = row as Record<string, unknown>;
    collectAndCheckId(rowRec, seenIds);

    if (!Array.isArray(rowRec.cells) || (rowRec.cells as unknown[]).length === 0) {
      throw new DocumentApiValidationError('INVALID_PAYLOAD', 'Table row must have at least one cell.', {
        field: 'cells',
      });
    }

    for (const cell of rowRec.cells as unknown[]) {
      assertPlainObject(cell);
      const cellRec = cell as Record<string, unknown>;
      collectAndCheckId(cellRec, seenIds);

      // Rule 6: row/cell spans must be valid positive integers
      validatePositiveInt(cellRec, 'rowSpan');
      validatePositiveInt(cellRec, 'colSpan');

      if (cellRec.header !== undefined && typeof cellRec.header !== 'boolean') {
        throw new DocumentApiValidationError('INVALID_PAYLOAD', 'Table cell header must be a boolean.', {
          field: 'header',
        });
      }

      const allowedCellFields = new Set(['id', 'ext', 'props', 'rowSpan', 'colSpan', 'header', 'content']);
      const unknownCellField = Object.keys(cellRec).find((field) => !allowedCellFields.has(field));
      if (unknownCellField) {
        throw new DocumentApiValidationError('INVALID_PAYLOAD', `Unknown table cell field "${unknownCellField}".`, {
          field: unknownCellField,
        });
      }

      // Validate cell content (block-level children)
      if (!Array.isArray(cellRec.content)) {
        throw new DocumentApiValidationError('INVALID_PAYLOAD', 'Table cell content must be an array.', {
          field: 'content',
        });
      }
      for (const child of cellRec.content as unknown[]) {
        validateContentNode(child, seenIds);
      }
    }
  }
}

function validateHorizontalRule(rec: Record<string, unknown>): void {
  const payload = rec.horizontalRule;
  if (!isRecord(payload)) {
    throw new DocumentApiValidationError('INVALID_PAYLOAD', 'horizontalRule payload must be an object.');
  }
  if (Object.keys(payload).length > 0) {
    throw new DocumentApiValidationError('INVALID_PAYLOAD', 'horizontalRule payload must be empty.');
  }
  const allowedFields = new Set(['kind', 'id', 'horizontalRule']);
  const unknownField = Object.keys(rec).find((field) => !allowedFields.has(field));
  if (unknownField) {
    throw new DocumentApiValidationError('INVALID_PAYLOAD', `Unknown horizontalRule field "${unknownField}".`, {
      field: unknownField,
    });
  }
}

function validatePositiveInt(rec: Record<string, unknown>, field: string): void {
  const val = rec[field];
  if (val === undefined) return;
  if (typeof val !== 'number' || !Number.isInteger(val) || val < 1) {
    throw new DocumentApiValidationError(
      'INVALID_PAYLOAD',
      `${field} must be a positive integer, got ${JSON.stringify(val)}.`,
      { field },
    );
  }
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

function validateListPayload(rec: Record<string, unknown>, seenIds: Set<string>): void {
  const payload = rec.list as Record<string, unknown> | undefined;
  if (!payload) {
    throw new DocumentApiValidationError('INVALID_PAYLOAD', 'list payload must be an object.');
  }

  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw new DocumentApiValidationError('INVALID_PAYLOAD', 'List must have at least one item.', { field: 'items' });
  }

  for (const item of payload.items as unknown[]) {
    assertPlainObject(item);
    const itemRec = item as Record<string, unknown>;
    collectAndCheckId(itemRec, seenIds);

    // Validate item inlines (flat list items)
    if (itemRec.inlines !== undefined) {
      validateInlinesArray(itemRec.inlines, 'listItem', seenIds);
    }

    // Validate item content (block-level children)
    if (Array.isArray(itemRec.content)) {
      for (const child of itemRec.content as unknown[]) {
        validateContentNode(child, seenIds);
        // Rule 16: paragraph.numbering inside SDList is a conflict
        rejectNumberingInsideListItem(child);
      }
    }
  }
}

/**
 * Rule 16: Conflicting list context and paragraph.numbering metadata.
 *
 * When a paragraph is inside an SDList item, its numbering is determined
 * by the list context. Explicitly providing `paragraph.props.numbering`
 * (or `heading.props.numbering`) would conflict with the list semantics.
 */
function rejectNumberingInsideListItem(node: unknown): void {
  if (!isRecord(node)) return;
  const rec = node as Record<string, unknown>;
  const kind = rec.kind;

  if (kind === 'paragraph' || kind === 'heading') {
    const payload = rec[kind as string] as Record<string, unknown> | undefined;
    if (!payload) return;

    const props = payload.props as Record<string, unknown> | undefined;
    if (props?.numbering != null) {
      throw new DocumentApiValidationError(
        'INVALID_PAYLOAD',
        `${kind}.props.numbering conflicts with SDList context. ` +
          'Use SDList levels to define numbering; paragraph-level numbering is read-only fidelity data.',
        { field: 'numbering', kind: kind as string },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

function validateImagePayload(rec: Record<string, unknown>): void {
  const payload = rec.image as Record<string, unknown> | undefined;
  if (!payload) {
    throw new DocumentApiValidationError('INVALID_PAYLOAD', 'image payload must be an object.');
  }

  if (typeof payload.src !== 'string' || payload.src.length === 0) {
    throw new DocumentApiValidationError('INVALID_PAYLOAD', 'Image node requires a non-empty "src" string.', {
      field: 'src',
    });
  }
}

// ---------------------------------------------------------------------------
// SDT / CustomXml: Rule 7
// ---------------------------------------------------------------------------

function validateSdtPayload(rec: Record<string, unknown>, kind: string, seenIds: Set<string>): void {
  const payload = rec[kind] as Record<string, unknown> | undefined;
  if (!payload) return;

  const hasInlines = payload.inlines !== undefined;
  const hasContent = payload.content !== undefined;

  // Rule 7: exactly one of inlines/content
  if (hasInlines && hasContent) {
    throw new DocumentApiValidationError(
      'INVALID_PAYLOAD',
      `${kind} must provide either "inlines" or "content", not both.`,
      { kind },
    );
  }

  if (hasInlines) {
    validateInlinesArray(payload.inlines, kind, seenIds);
  }
  if (hasContent && Array.isArray(payload.content)) {
    for (const child of payload.content as unknown[]) {
      validateContentNode(child, seenIds);
    }
  }
}

// ---------------------------------------------------------------------------
// TOC: Rules 10, 11, 12
// ---------------------------------------------------------------------------

function validateTocPayload(rec: Record<string, unknown>): void {
  const payload = rec.toc as Record<string, unknown> | undefined;
  if (!payload) return;

  const sourceConfig = isRecord(payload.sourceConfig) ? (payload.sourceConfig as Record<string, unknown>) : undefined;
  const displayConfig = isRecord(payload.displayConfig)
    ? (payload.displayConfig as Record<string, unknown>)
    : undefined;

  // Rule 10: sourceConfig.outlineLevels: ranges 1..9, from <= to
  if (sourceConfig && isRecord(sourceConfig.outlineLevels)) {
    const range = sourceConfig.outlineLevels as Record<string, unknown>;
    const from = range.from;
    const to = range.to;
    if (typeof from === 'number' && (from < 1 || from > 9)) {
      throw new DocumentApiValidationError(
        'INVALID_PAYLOAD',
        `TOC sourceConfig.outlineLevels.from must be 1–9, got ${from}.`,
      );
    }
    if (typeof to === 'number' && (to < 1 || to > 9)) {
      throw new DocumentApiValidationError(
        'INVALID_PAYLOAD',
        `TOC sourceConfig.outlineLevels.to must be 1–9, got ${to}.`,
      );
    }
    if (typeof from === 'number' && typeof to === 'number' && from > to) {
      throw new DocumentApiValidationError(
        'INVALID_PAYLOAD',
        `TOC sourceConfig.outlineLevels.from (${from}) must be <= to (${to}).`,
      );
    }
  }

  // Rule 10b: sourceConfig.tcFieldLevels: same range constraints
  if (sourceConfig && isRecord(sourceConfig.tcFieldLevels)) {
    const range = sourceConfig.tcFieldLevels as Record<string, unknown>;
    const from = range.from;
    const to = range.to;
    if (typeof from === 'number' && (from < 1 || from > 9)) {
      throw new DocumentApiValidationError(
        'INVALID_PAYLOAD',
        `TOC sourceConfig.tcFieldLevels.from must be 1–9, got ${from}.`,
      );
    }
    if (typeof to === 'number' && (to < 1 || to > 9)) {
      throw new DocumentApiValidationError(
        'INVALID_PAYLOAD',
        `TOC sourceConfig.tcFieldLevels.to must be 1–9, got ${to}.`,
      );
    }
    if (typeof from === 'number' && typeof to === 'number' && from > to) {
      throw new DocumentApiValidationError(
        'INVALID_PAYLOAD',
        `TOC sourceConfig.tcFieldLevels.from (${from}) must be <= to (${to}).`,
      );
    }
  }

  // Rule 11: displayConfig.includePageNumbers vs displayConfig.omitPageNumberLevels mutual exclusion
  if (displayConfig) {
    if (displayConfig.includePageNumbers === false && isRecord(displayConfig.omitPageNumberLevels)) {
      throw new DocumentApiValidationError(
        'INVALID_PAYLOAD',
        'TOC cannot set displayConfig.includePageNumbers=false and also provide displayConfig.omitPageNumberLevels.',
      );
    }

    // Rule 12: displayConfig.tabLeader vs displayConfig.separator mutual exclusion
    if (displayConfig.tabLeader !== undefined && displayConfig.separator !== undefined) {
      throw new DocumentApiValidationError(
        'INVALID_PAYLOAD',
        'TOC cannot set both displayConfig.tabLeader and displayConfig.separator.',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// SectionBreak: shape check (Rule 15 contextual check is adapter-level)
// ---------------------------------------------------------------------------

function validateSectionBreakPayload(rec: Record<string, unknown>): void {
  const payload = rec.sectionBreak as Record<string, unknown> | undefined;
  if (!payload) return;

  // Shape check only: targetSectionId must be a non-empty string when present
  if (payload.targetSectionId !== undefined) {
    if (typeof payload.targetSectionId !== 'string' || payload.targetSectionId.length === 0) {
      throw new DocumentApiValidationError(
        'INVALID_PAYLOAD',
        'sectionBreak.targetSectionId must be a non-empty string when provided.',
        { field: 'targetSectionId' },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Inline validation: Rules 4, 8
// ---------------------------------------------------------------------------

function validateInlinesArray(inlines: unknown, parentKind: string, seenIds: Set<string>): void {
  if (!Array.isArray(inlines)) {
    throw new DocumentApiValidationError('INVALID_PAYLOAD', `${parentKind} inlines must be an array.`, {
      field: 'inlines',
    });
  }
  for (const item of inlines) {
    validateInlineNode(item, parentKind, seenIds, false);
  }
}

function validateInlineNode(node: unknown, parentKind: string, seenIds: Set<string>, insideHyperlink: boolean): void {
  assertPlainObject(node);

  const rec = node as Record<string, unknown>;

  // Inline nodes use `kind` discriminant
  if (typeof rec.kind !== 'string') {
    throw new DocumentApiValidationError(
      'INVALID_PAYLOAD',
      `Each inline node in ${parentKind} must have a string "kind" field.`,
    );
  }

  const kind = rec.kind;

  // Check against known inline kinds + extensions
  if (!INLINE_KIND_SET.has(kind) && !kind.startsWith('ext.')) {
    throw new DocumentApiValidationError(
      'INVALID_PAYLOAD',
      `"${kind}" is not a valid inline node kind in ${parentKind}.`,
      { kind },
    );
  }

  collectAndCheckId(rec, seenIds);

  // Rule 8: Hyperlink nesting forbidden
  if (kind === 'hyperlink') {
    if (insideHyperlink) {
      throw new DocumentApiValidationError('INVALID_NESTING', 'Hyperlinks cannot be nested inside other hyperlinks.');
    }
    const hPayload = rec.hyperlink as Record<string, unknown> | undefined;
    if (hPayload && Array.isArray(hPayload.inlines)) {
      for (const child of hPayload.inlines as unknown[]) {
        validateInlineNode(child, 'hyperlink', seenIds, true);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Legacy shape validation (type-discriminated, backward compat)
// ---------------------------------------------------------------------------

function validateLegacyTopLevelNode(node: unknown): void {
  assertLegacyNodeShape(node);

  const rec = node as Record<string, unknown>;
  const type = rec.type as string;

  if (!LEGACY_TOP_LEVEL_TYPES.has(type)) {
    throw new DocumentApiValidationError(
      'INVALID_PAYLOAD',
      `"${type}" is not valid at the top level. ` + `Valid types: ${[...LEGACY_TOP_LEVEL_TYPES].join(', ')}.`,
      { nodeType: type },
    );
  }

  validateLegacyNodeContent(rec, type);
}

function assertLegacyNodeShape(node: unknown): void {
  if (!isRecord(node)) {
    throw new DocumentApiValidationError('INVALID_PAYLOAD', 'Each node in a fragment must be a plain object.');
  }
  const rec = node as Record<string, unknown>;
  if (typeof rec.kind !== 'string' && typeof rec.type !== 'string') {
    throw new DocumentApiValidationError(
      'INVALID_PAYLOAD',
      'Each node must have a string "kind" (SDM/1) or "type" (legacy) field.',
    );
  }
}

function validateLegacyNodeContent(node: Record<string, unknown>, type: string): void {
  switch (type) {
    case 'paragraph':
      if (node.content !== undefined) validateLegacyInlineArray(node.content, 'paragraph');
      break;
    case 'heading':
      validateLegacyHeading(node);
      break;
    case 'table':
      validateLegacyTable(node);
      break;
    case 'list':
      validateLegacyList(node);
      break;
    case 'sdt':
      validateLegacySdt(node);
      break;
    case 'image':
      validateLegacyImage(node);
      break;
  }
}

function validateLegacyHeading(node: Record<string, unknown>): void {
  const level = node.level;
  if (typeof level !== 'number' || level < 1 || level > 6 || !Number.isInteger(level)) {
    throw new DocumentApiValidationError(
      'INVALID_PAYLOAD',
      `Heading level must be an integer between 1 and 6, got ${JSON.stringify(level)}.`,
      { field: 'level' },
    );
  }
  if (node.content !== undefined) validateLegacyInlineArray(node.content, 'heading');
}

function validateLegacyTable(node: Record<string, unknown>): void {
  // Two interoperable legacy table shapes are accepted:
  //   - the simplified legacy shape: rows under `rows`, cells under `cells`,
  //     cell type `tableCell`;
  //   - the ProseMirror/SuperDoc node shape: rows under `content`, cells under
  //     `content`, cell type `tableCell` OR `tableHeader`.
  // The PM shape is the public `presetContent.json` table contract the v1
  // baseline ingests; accepting it here keeps v2 at parity (TB-PAR-022).
  const rows = Array.isArray(node.rows)
    ? (node.rows as unknown[])
    : Array.isArray(node.content)
      ? (node.content as unknown[])
      : null;
  if (!rows || rows.length === 0) {
    throw new DocumentApiValidationError('INVALID_PAYLOAD', 'Table must have at least one row.', { field: 'rows' });
  }
  for (const row of rows) {
    assertLegacyNodeShape(row);
    const rowRec = row as Record<string, unknown>;
    if (rowRec.type !== 'tableRow') {
      throw new DocumentApiValidationError(
        'INVALID_PAYLOAD',
        `Table rows must have type "tableRow", got "${String(rowRec.type)}".`,
      );
    }
    const cells = Array.isArray(rowRec.cells)
      ? (rowRec.cells as unknown[])
      : Array.isArray(rowRec.content)
        ? (rowRec.content as unknown[])
        : null;
    if (!cells || cells.length === 0) {
      throw new DocumentApiValidationError('INVALID_PAYLOAD', 'Table row must have at least one cell.', {
        field: 'cells',
      });
    }
    for (const cell of cells) {
      assertLegacyNodeShape(cell);
      const cellRec = cell as Record<string, unknown>;
      if (cellRec.type !== 'tableCell' && cellRec.type !== 'tableHeader') {
        throw new DocumentApiValidationError(
          'INVALID_PAYLOAD',
          `Table cells must have type "tableCell" or "tableHeader", got "${String(cellRec.type)}".`,
        );
      }
      if (cellRec.content !== undefined) {
        if (!Array.isArray(cellRec.content)) {
          throw new DocumentApiValidationError('INVALID_PAYLOAD', 'Table cell content must be an array.');
        }
        for (const child of cellRec.content as unknown[]) {
          assertLegacyNodeShape(child);
          const childType = (child as Record<string, unknown>).type;
          if (childType !== 'paragraph' && childType !== 'heading') {
            throw new DocumentApiValidationError(
              'INVALID_PAYLOAD',
              `Table cell content must be paragraphs or headings, got "${String(childType)}".`,
            );
          }
        }
      }
    }
  }
}

function validateLegacyList(node: Record<string, unknown>): void {
  if (!Array.isArray(node.items) || node.items.length === 0) {
    throw new DocumentApiValidationError('INVALID_PAYLOAD', 'List must have at least one item.', { field: 'items' });
  }
  for (const item of node.items as unknown[]) {
    assertLegacyNodeShape(item);
    const itemRec = item as Record<string, unknown>;
    if (itemRec.type !== 'listItem') {
      throw new DocumentApiValidationError(
        'INVALID_PAYLOAD',
        `List items must have type "listItem", got "${String(itemRec.type)}".`,
      );
    }
    if (itemRec.content !== undefined) {
      validateLegacyInlineArray(itemRec.content, 'listItem');
    }
  }
}

function validateLegacySdt(node: Record<string, unknown>): void {
  if (node.content !== undefined) {
    if (!Array.isArray(node.content)) {
      throw new DocumentApiValidationError('INVALID_PAYLOAD', 'SDT content must be an array.');
    }
    for (const child of node.content as unknown[]) {
      assertLegacyNodeShape(child);
      const childType = (child as Record<string, unknown>).type;
      if (childType !== 'paragraph' && childType !== 'heading') {
        throw new DocumentApiValidationError(
          'INVALID_PAYLOAD',
          `SDT content must be paragraphs or headings, got "${String(childType)}".`,
        );
      }
    }
  }
}

function validateLegacyImage(node: Record<string, unknown>): void {
  if (typeof node.src !== 'string' || (node.src as string).length === 0) {
    throw new DocumentApiValidationError('INVALID_PAYLOAD', 'Image node requires a non-empty "src" string.', {
      field: 'src',
    });
  }
}

function validateLegacyInlineArray(content: unknown, parentType: string): void {
  if (!Array.isArray(content)) {
    throw new DocumentApiValidationError(
      'INVALID_PAYLOAD',
      `${parentType} content must be an array of inline content.`,
      { field: 'content' },
    );
  }
  for (const item of content) {
    validateLegacyInlineContent(item, parentType);
  }
}

function validateLegacyInlineContent(item: unknown, parentType: string): void {
  if (!isRecord(item)) {
    throw new DocumentApiValidationError(
      'INVALID_PAYLOAD',
      `Each inline content item in ${parentType} must be a plain object.`,
    );
  }

  const itemType = (item as Record<string, unknown>).type;
  if (itemType !== 'text' && itemType !== 'image') {
    throw new DocumentApiValidationError(
      'INVALID_PAYLOAD',
      `Inline content type must be "text" or "image", got "${String(itemType)}".`,
      { field: 'type' },
    );
  }

  if (itemType === 'text') {
    if (typeof (item as Record<string, unknown>).text !== 'string') {
      throw new DocumentApiValidationError(
        'INVALID_PAYLOAD',
        `Inline text content in ${parentType} requires a "text" string field.`,
        { field: 'text' },
      );
    }
  } else if (itemType === 'image') {
    const src = (item as Record<string, unknown>).src;
    if (typeof src !== 'string' || src.length === 0) {
      throw new DocumentApiValidationError(
        'INVALID_PAYLOAD',
        `Inline image content in ${parentType} requires a non-empty "src" string field.`,
        { field: 'src' },
      );
    }
  }
}
