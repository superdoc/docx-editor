import type { OperationId } from './types.js';

export type StepOpDomain = 'assert' | 'text' | 'format' | 'create' | 'tables' | 'structural' | 'internal';
export type StepOpSurface = 'public' | 'internal';

export interface StepOpCatalogEntry<
  OpId extends string = string,
  Domain extends StepOpDomain = StepOpDomain,
  Surface extends StepOpSurface = StepOpSurface,
> {
  opId: OpId;
  domain: Domain;
  surface: Surface;
  description: string;
  referenceOperationId?: OperationId;
}

function step<
  const OpId extends string,
  const Domain extends StepOpDomain,
  const Surface extends StepOpSurface = 'public',
>(
  opId: OpId,
  domain: Domain,
  description: string,
  options: { surface?: Surface; referenceOperationId?: OperationId } = {},
): StepOpCatalogEntry<OpId, Domain, Surface> {
  return {
    opId,
    domain,
    surface: (options.surface ?? 'public') as Surface,
    description,
    ...(options.referenceOperationId ? { referenceOperationId: options.referenceOperationId } : {}),
  };
}

const STEP_OP_CATALOG_UNFROZEN = [
  step('assert', 'assert', 'Assert selector cardinality after mutation steps complete.'),

  step('text.rewrite', 'text', 'Rewrite matched text ranges with replacement content.', {
    referenceOperationId: 'replace',
  }),
  step('text.insert', 'text', 'Insert text before or after a matched range.', {
    referenceOperationId: 'insert',
  }),
  step('text.delete', 'text', 'Delete matched text ranges.', {
    referenceOperationId: 'delete',
  }),

  step('format.apply', 'format', 'Apply inline formatting patch changes to matched text ranges.', {
    referenceOperationId: 'format.apply',
  }),

  step('create.paragraph', 'create', 'Create a paragraph adjacent to the matched block.', {
    referenceOperationId: 'create.paragraph',
  }),
  step('create.heading', 'create', 'Create a heading adjacent to the matched block.', {
    referenceOperationId: 'create.heading',
  }),
  step('create.table', 'create', 'Create a table at the requested location.', {
    referenceOperationId: 'create.table',
  }),

  step('tables.delete', 'tables', 'Delete the target table from the document.', {
    referenceOperationId: 'tables.delete',
  }),
  step('tables.clearContents', 'tables', 'Clear contents from a target table or cell range.', {
    referenceOperationId: 'tables.clearContents',
  }),
  step('tables.move', 'tables', 'Move a table to a new position.', {
    referenceOperationId: 'tables.move',
  }),
  step('tables.split', 'tables', 'Split a table into two tables at a target row.', {
    referenceOperationId: 'tables.split',
  }),
  step('tables.convertFromText', 'tables', 'Convert a text range into a table.', {
    referenceOperationId: 'tables.convertFromText',
  }),
  step('tables.convertToText', 'tables', 'Convert a table to plain text.', {
    referenceOperationId: 'tables.convertToText',
  }),
  step('tables.setLayout', 'tables', 'Set table layout mode.', {
    referenceOperationId: 'tables.setLayout',
  }),
  step('tables.insertRow', 'tables', 'Insert a row into the target table.', {
    referenceOperationId: 'tables.insertRow',
  }),
  step('tables.deleteRow', 'tables', 'Delete a row from the target table.', {
    referenceOperationId: 'tables.deleteRow',
  }),
  step('tables.moveRow', 'tables', 'Move a row to a new position within the same table.', {
    referenceOperationId: 'tables.moveRow',
  }),
  step('tables.setRowHeight', 'tables', 'Set row height in the target table.', {
    referenceOperationId: 'tables.setRowHeight',
  }),
  step('tables.distributeRows', 'tables', 'Distribute row heights evenly.', {
    referenceOperationId: 'tables.distributeRows',
  }),
  step('tables.setRowOptions', 'tables', 'Set row-level options (header repeat, page break, etc.).', {
    referenceOperationId: 'tables.setRowOptions',
  }),
  step('tables.insertColumn', 'tables', 'Insert a column into the target table.', {
    referenceOperationId: 'tables.insertColumn',
  }),
  step('tables.deleteColumn', 'tables', 'Delete a column from the target table.', {
    referenceOperationId: 'tables.deleteColumn',
  }),
  step('tables.moveColumn', 'tables', 'Move a column to a new position within the same table.', {
    referenceOperationId: 'tables.moveColumn',
  }),
  step('tables.setColumnWidth', 'tables', 'Set column width in the target table.', {
    referenceOperationId: 'tables.setColumnWidth',
  }),
  step('tables.distributeColumns', 'tables', 'Distribute column widths evenly.', {
    referenceOperationId: 'tables.distributeColumns',
  }),
  step('tables.insertCell', 'tables', 'Insert a cell into a table row.', {
    referenceOperationId: 'tables.insertCell',
  }),
  step('tables.deleteCell', 'tables', 'Delete a cell from a table row.', {
    referenceOperationId: 'tables.deleteCell',
  }),
  step('tables.mergeCells', 'tables', 'Merge a range of table cells.', {
    referenceOperationId: 'tables.mergeCells',
  }),
  step('tables.unmergeCells', 'tables', 'Unmerge a merged table cell.', {
    referenceOperationId: 'tables.unmergeCells',
  }),
  step('tables.splitCell', 'tables', 'Split a table cell into multiple cells.', {
    referenceOperationId: 'tables.splitCell',
  }),
  step('tables.setCellProperties', 'tables', 'Set properties on target table cells.', {
    referenceOperationId: 'tables.setCellProperties',
  }),
  step('tables.sort', 'tables', 'Sort table rows by a column value.', {
    referenceOperationId: 'tables.sort',
  }),
  step('tables.setAltText', 'tables', 'Set table alt text properties.', {
    referenceOperationId: 'tables.setAltText',
  }),
  step('tables.setStyle', 'tables', 'Set or clear table style identifier.', {
    referenceOperationId: 'tables.setStyle',
  }),
  step('tables.clearStyle', 'tables', 'Clear direct table style assignment.', {
    referenceOperationId: 'tables.clearStyle',
  }),
  step('tables.setStyleOption', 'tables', 'Set table style option flags.', {
    referenceOperationId: 'tables.setStyleOption',
  }),
  step('tables.setBorder', 'tables', 'Set table border properties.', {
    referenceOperationId: 'tables.setBorder',
  }),
  step('tables.clearBorder', 'tables', 'Clear table border properties.', {
    referenceOperationId: 'tables.clearBorder',
  }),
  step('tables.applyBorderPreset', 'tables', 'Apply a border preset to a table.', {
    referenceOperationId: 'tables.applyBorderPreset',
  }),
  step('tables.setShading', 'tables', 'Set table shading properties.', {
    referenceOperationId: 'tables.setShading',
  }),
  step('tables.clearShading', 'tables', 'Clear table shading properties.', {
    referenceOperationId: 'tables.clearShading',
  }),
  step('tables.setTablePadding', 'tables', 'Set table-level cell padding.', {
    referenceOperationId: 'tables.setTablePadding',
  }),
  step('tables.setCellPadding', 'tables', 'Set cell padding for target cells.', {
    referenceOperationId: 'tables.setCellPadding',
  }),
  step('tables.setCellSpacing', 'tables', 'Set table cell spacing.', {
    referenceOperationId: 'tables.setCellSpacing',
  }),
  step('tables.clearCellSpacing', 'tables', 'Clear table cell spacing.', {
    referenceOperationId: 'tables.clearCellSpacing',
  }),

  // Structural content operations
  step('structural.insert', 'structural', 'Insert structural content (SDFragment) at a target position.', {
    referenceOperationId: 'insert',
  }),
  step('structural.replace', 'structural', 'Replace content at a target range with structural content (SDFragment).', {
    referenceOperationId: 'replace',
  }),

  // Internal bridge op used by wrappers that execute pre-compiled plans with _handler closures.
  step('domain.command', 'internal', 'Internal wrapper bridge op. Not a user-authored step.', {
    surface: 'internal',
  }),
] as const satisfies readonly StepOpCatalogEntry[];

export const STEP_OP_CATALOG: readonly StepOpCatalogEntry[] = Object.freeze(
  STEP_OP_CATALOG_UNFROZEN.map((entry) => Object.freeze(entry)),
);

export type MutationStepOpId = (typeof STEP_OP_CATALOG_UNFROZEN)[number]['opId'];
type InternalStepOpCatalogEntry = Extract<(typeof STEP_OP_CATALOG_UNFROZEN)[number], { surface: 'internal' }>;
type InternalMutationStepOpId = InternalStepOpCatalogEntry['opId'];
export type PublicMutationStepOpId = Exclude<MutationStepOpId, InternalMutationStepOpId>;

const PUBLIC_STEP_OP_CATALOG_UNFROZEN = STEP_OP_CATALOG_UNFROZEN.filter(
  (entry) => entry.surface === 'public',
) as readonly StepOpCatalogEntry<PublicMutationStepOpId, StepOpDomain, 'public'>[];

export type PublicStepOpCatalogEntry = (typeof PUBLIC_STEP_OP_CATALOG_UNFROZEN)[number];

export const PUBLIC_STEP_OP_CATALOG: readonly StepOpCatalogEntry[] = Object.freeze(
  PUBLIC_STEP_OP_CATALOG_UNFROZEN.map((entry) => Object.freeze(entry)),
);

export const KNOWN_MUTATION_STEP_OP_IDS: readonly MutationStepOpId[] = Object.freeze(
  STEP_OP_CATALOG_UNFROZEN.map((entry) => entry.opId),
);
export const PUBLIC_MUTATION_STEP_OP_IDS: readonly PublicMutationStepOpId[] = Object.freeze(
  PUBLIC_STEP_OP_CATALOG_UNFROZEN.map((entry) => entry.opId),
);

const KNOWN_MUTATION_STEP_OP_SET: ReadonlySet<string> = new Set(KNOWN_MUTATION_STEP_OP_IDS);
const PUBLIC_MUTATION_STEP_OP_SET: ReadonlySet<string> = new Set(PUBLIC_MUTATION_STEP_OP_IDS);

export function isKnownMutationStepOp(opId: string): opId is MutationStepOpId {
  return KNOWN_MUTATION_STEP_OP_SET.has(opId);
}

export function isPublicMutationStepOp(opId: string): opId is PublicMutationStepOpId {
  return PUBLIC_MUTATION_STEP_OP_SET.has(opId);
}
