import type { TableBlock, TableMeasure, TableRowMeasure } from '@superdoc/contracts';
import type { FontMeasureContext } from '@superdoc/font-system';
import { getSurfaceMeasurementRuntime, type SurfaceMeasurementRuntimeState } from './measurement-runtime-context.js';

export type RetainedTableMeasurement = { block: TableBlock; measure: TableMeasure };

type TableMeasurementOwner = {
  block: TableBlock;
  runtime: SurfaceMeasurementRuntimeState;
  fontSignature: string;
  measurementRuntimeSignature: string;
  immutable: boolean;
  rowsCertified: number;
  rowsReusable: boolean;
};

type TableRowMeasurementOwner = {
  row: TableBlock['rows'][number];
  immutable: boolean;
  cellsCertified: number;
  alreadyCertified: boolean;
  pendingCell?: object;
  reusable: boolean;
};

type CompletedTableMeasurementOwner = {
  blockIdentity: object;
  runtimeIdentity: object;
  fontSignature: string;
  measurementRuntimeSignature: string;
  maxWidth: number;
  columnWidths: readonly number[];
  rowsReusable: boolean;
};

type RetainedRowGeometry = {
  sourceIdentity: object;
  baseHeight: number;
  authoredPadding: number;
  authoredChrome: number;
};

let measurementOwners = new WeakMap<TableMeasure, CompletedTableMeasurementOwner>();
const measurementIdentities = new WeakMap<object, object>();
const immutableData = createImmutableDataProofCache();
const reusableSourceRows = new WeakSet<object>();
const retainedRowGeometry = new WeakMap<TableRowMeasure, RetainedRowGeometry>();

function createImmutableDataProofCache() {
  // Large grids certify millions of objects. Bound each backing allocation and
  // total shortcuts; eviction requires inspection again, never assumed safety.
  const segments = [new WeakSet<object>()];
  let writes = 0;
  return {
    has(value: object): boolean {
      for (let index = segments.length - 1; index >= 0; index--) {
        if (segments[index]!.has(value)) return true;
      }
      return false;
    },
    add(value: object): void {
      if (writes === 131072) {
        if (segments.length === 8) segments.shift();
        segments.push(new WeakSet<object>());
        writes = 0;
      }
      segments[segments.length - 1]!.add(value);
      writes++;
    },
  };
}

function measurementIdentity(value: object): object {
  let identity = measurementIdentities.get(value);
  if (!identity) {
    identity = {};
    measurementIdentities.set(value, identity);
  }
  return identity;
}

export function clearRetainedTableMeasurements(): void {
  measurementOwners = new WeakMap();
}

// A frozen container can still expose changing getters or mutable descendants.
// Only memoize complete plain-data subtrees, without changing caller objects.
type ImmutableDataState = 'mutable' | 'immutable' | 'pending-table';

function inspectImmutableData(
  value: unknown,
  allowPendingTables = false,
  visiting = new WeakSet<object>(),
): ImmutableDataState {
  if (value == null || typeof value !== 'object') {
    return typeof value === 'function' || typeof value === 'symbol' ? 'mutable' : 'immutable';
  }
  if (immutableData.has(value)) return 'immutable';
  if (visiting.has(value) || !Object.isFrozen(value)) return 'mutable';
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) return 'mutable';
  // Nested tables are certified by their own cooperative measurement walk.
  if (Object.getOwnPropertyDescriptor(value, 'kind')?.value === 'table') {
    return allowPendingTables ? 'pending-table' : 'mutable';
  }
  visiting.add(value);
  let state: ImmutableDataState = 'immutable';
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const childState =
      descriptor && 'value' in descriptor
        ? inspectImmutableData(descriptor.value, allowPendingTables, visiting)
        : 'mutable';
    if (childState === 'mutable') {
      visiting.delete(value);
      return 'mutable';
    }
    if (childState === 'pending-table') state = 'pending-table';
  }
  visiting.delete(value);
  if (state === 'immutable') immutableData.add(value);
  return state;
}

function isFrozenArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && Object.isFrozen(value) && Object.getPrototypeOf(value) === Array.prototype;
}

function isImmutableContainerExcept(value: object, childKey: string): boolean {
  if (!Object.isFrozen(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) return false;
    if (key === childKey ? !isFrozenArray(descriptor.value) : inspectImmutableData(descriptor.value) !== 'immutable') {
      return false;
    }
  }
  return true;
}

function immutableArrayEntry(array: readonly unknown[], index: number, value: unknown): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(array, index);
  return !!descriptor && 'value' in descriptor && descriptor.value === value;
}

export function createTableMeasurementOwner(
  block: TableBlock,
  fontContext: FontMeasureContext,
  measurementRuntimeSignature: string,
): TableMeasurementOwner | null {
  const runtime = getSurfaceMeasurementRuntime(fontContext);
  if (!runtime) return null;
  return {
    block,
    runtime,
    fontSignature: fontContext.fontSignature,
    measurementRuntimeSignature,
    immutable: isImmutableContainerExcept(block, 'rows') && isFrozenArray(block.rows),
    rowsCertified: 0,
    rowsReusable: hasStandardObjectPrototype(),
  };
}

export function createTableRowMeasurementOwner(
  owner: TableMeasurementOwner | null,
  rowIndex: number,
): TableRowMeasurementOwner | null {
  if (!owner?.immutable) return null;
  const row = owner.block.rows[rowIndex]!;
  const alreadyCertified = immutableData.has(row);
  return {
    row,
    immutable:
      immutableArrayEntry(owner.block.rows, rowIndex, row) &&
      (alreadyCertified || (isImmutableContainerExcept(row, 'cells') && isFrozenArray(row.cells))),
    cellsCertified: 0,
    alreadyCertified,
    reusable: true,
  };
}

export function prepareTableMeasurementCell(owner: TableRowMeasurementOwner | null, cellIndex: number): void {
  if (!owner?.immutable) return;
  const cell = owner.row.cells[cellIndex]!;
  owner.reusable &&=
    (cell.rowSpan ?? 1) === 1 &&
    cell.paragraph == null &&
    Array.isArray(cell.blocks) &&
    cell.blocks.every((block) => block.kind === 'paragraph');
  if (owner.alreadyCertified) return;
  const state = immutableArrayEntry(owner.row.cells, cellIndex, cell) ? inspectImmutableData(cell, true) : 'mutable';
  owner.immutable = state !== 'mutable';
  owner.pendingCell = state === 'pending-table' ? cell : undefined;
}

export function certifyTableMeasurementCell(owner: TableRowMeasurementOwner | null): void {
  if (!owner?.immutable) return;
  if (owner.pendingCell) {
    owner.immutable = inspectImmutableData(owner.pendingCell) === 'immutable';
    owner.pendingCell = undefined;
  }
  owner.cellsCertified += 1;
}

export function finishTableRowMeasurementOwner(
  owner: TableMeasurementOwner | null,
  row: TableRowMeasurementOwner | null,
): void {
  if (!owner?.immutable) return;
  if (!row?.immutable || row.cellsCertified !== row.row.cells.length) {
    owner.immutable = false;
    return;
  }
  immutableData.add(row.row.cells);
  immutableData.add(row.row);
  if (row.reusable) reusableSourceRows.add(row.row);
  owner.rowsReusable &&= row.reusable;
  owner.rowsCertified += 1;
}

// Only a changed row's topology is needed before assembly. Content immutability
// is still certified by the normal cooperative cell measurement walk.
function hasFrozenPlainPrototype(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return Object.isFrozen(value) && (prototype === Object.prototype || prototype === null);
}

function hasFrozenReusableTopology(row: TableBlock['rows'][number]): boolean {
  if (!hasFrozenPlainPrototype(row)) return false;
  const cellsDescriptor = Object.getOwnPropertyDescriptor(row, 'cells');
  const cells = cellsDescriptor && 'value' in cellsDescriptor ? cellsDescriptor.value : null;
  if (!isFrozenArray(cells) || cells.length > 256) return false;
  for (let index = 0; index < cells.length; index++) {
    const cell = Object.getOwnPropertyDescriptor(cells, index)?.value;
    if (!cell || !hasFrozenPlainPrototype(cell)) return false;
    const span = Object.getOwnPropertyDescriptor(cell, 'rowSpan');
    const legacy = Object.getOwnPropertyDescriptor(cell, 'paragraph');
    const blocksDescriptor = Object.getOwnPropertyDescriptor(cell, 'blocks');
    if (
      (span && (!('value' in span) || (span.value ?? 1) !== 1)) ||
      (legacy && (!('value' in legacy) || legacy.value != null))
    )
      return false;
    const blocks = blocksDescriptor && 'value' in blocksDescriptor ? blocksDescriptor.value : null;
    if (!isFrozenArray(blocks) || blocks.length > 32) return false;
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
      const block = Object.getOwnPropertyDescriptor(blocks, blockIndex)?.value;
      if (
        !block ||
        !hasFrozenPlainPrototype(block) ||
        Object.getOwnPropertyDescriptor(block, 'kind')?.value !== 'paragraph'
      )
        return false;
    }
  }
  return true;
}

const standardObjectPrototypeKeys = new Set<PropertyKey>([
  'constructor',
  '__defineGetter__',
  '__defineSetter__',
  'hasOwnProperty',
  '__lookupGetter__',
  '__lookupSetter__',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toString',
  'valueOf',
  '__proto__',
  'toLocaleString',
]);

function hasStandardObjectPrototype(): boolean {
  return Reflect.ownKeys(Object.prototype).every((key) => standardObjectPrototypeKeys.has(key));
}

export function prepareRetainedTableRows(
  retained: RetainedTableMeasurement | undefined,
  owner: TableMeasurementOwner | null,
  maxWidth: number,
  columnWidths: readonly number[],
): RetainedTableMeasurement | undefined {
  // Frozen source objects can still inherit mutable geometry from a polluted prototype.
  if (!retained || !owner?.immutable || !hasStandardObjectPrototype()) return undefined;
  const previous = measurementOwners.get(retained.measure);
  const block = owner.block;
  if (
    !previous?.rowsReusable ||
    block.attrs?.tableLayout !== 'fixed' ||
    block.attrs !== retained.block.attrs ||
    block.columnWidths !== retained.block.columnWidths ||
    block.rows.length !== retained.block.rows.length ||
    maxWidth !== previous.maxWidth ||
    columnWidths.length !== previous.columnWidths.length ||
    columnWidths.some((width, index) => !Number.isFinite(width) || width !== previous.columnWidths[index])
  )
    return undefined;
  let changedRow: TableBlock['rows'][number] | undefined;
  for (let index = 0; index < block.rows.length; index++) {
    const row = block.rows[index]!;
    if (!immutableArrayEntry(block.rows, index, row)) return undefined;
    if (reusableSourceRows.has(row)) continue;
    if (changedRow) return undefined;
    changedRow = row;
  }
  if (changedRow && !hasFrozenReusableTopology(changedRow)) return undefined;
  return retained;
}

export function readRetainedTableRow(
  retained: RetainedTableMeasurement | undefined,
  owner: TableMeasurementOwner | null,
  rowIndex: number,
): { measure: TableRowMeasure; geometry: RetainedRowGeometry } | undefined {
  if (!retained || !owner?.immutable) return undefined;
  const row = owner.block.rows[rowIndex]!;
  if (
    row !== retained.block.rows[rowIndex] ||
    !reusableSourceRows.has(row) ||
    (rowIndex > 0 && owner.block.rows[rowIndex - 1] !== retained.block.rows[rowIndex - 1])
  )
    return undefined;
  const measure = retained.measure.rows[rowIndex];
  const geometry = measure && retainedRowGeometry.get(measure);
  if (!geometry || geometry.sourceIdentity !== measurementIdentities.get(row)) return undefined;
  owner.rowsCertified += 1;
  return { measure, geometry };
}

export function recordTableRowGeometry(
  owner: TableRowMeasurementOwner | null,
  measure: TableRowMeasure,
  baseHeight: number,
  authoredPadding: number,
  authoredChrome: number,
): void {
  if (!owner?.immutable || !owner.reusable || owner.cellsCertified !== owner.row.cells.length) return;
  retainedRowGeometry.set(measure, {
    sourceIdentity: measurementIdentity(owner.row),
    baseHeight,
    authoredPadding,
    authoredChrome,
  });
}

export function readRetainedTableMeasurement(
  retained: RetainedTableMeasurement | undefined,
  owner: TableMeasurementOwner | null,
): RetainedTableMeasurement | undefined {
  if (!retained || !owner) return undefined;
  const previous = measurementOwners.get(retained.measure);
  return previous &&
    previous.blockIdentity === measurementIdentities.get(retained.block) &&
    previous.runtimeIdentity === measurementIdentities.get(owner.runtime) &&
    previous.fontSignature === owner.fontSignature &&
    previous.measurementRuntimeSignature === owner.measurementRuntimeSignature
    ? retained
    : undefined;
}

export function recordTableMeasurementOwner(
  measure: TableMeasure,
  owner: TableMeasurementOwner | null,
  maxWidth: number,
): void {
  if (owner?.immutable && owner.rowsCertified === owner.block.rows.length) {
    immutableData.add(owner.block.rows);
    immutableData.add(owner.block);
    // Global measurement caches may outlive the surface. Identity tokens prove
    // ownership without keeping the source table or disposed runtime alive.
    measurementOwners.set(measure, {
      blockIdentity: measurementIdentity(owner.block),
      runtimeIdentity: measurementIdentity(owner.runtime),
      fontSignature: owner.fontSignature,
      measurementRuntimeSignature: owner.measurementRuntimeSignature,
      maxWidth,
      columnWidths: measure.columnWidths.slice(),
      rowsReusable: owner.rowsReusable && hasStandardObjectPrototype(),
    });
  }
}
