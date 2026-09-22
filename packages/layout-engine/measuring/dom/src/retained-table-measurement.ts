import type { TableBlock, TableMeasure } from '@superdoc/contracts';
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
};

type TableRowMeasurementOwner = {
  row: TableBlock['rows'][number];
  immutable: boolean;
  cellsCertified: number;
  alreadyCertified: boolean;
  pendingCell?: object;
};

type CompletedTableMeasurementOwner = {
  blockIdentity: object;
  runtimeIdentity: object;
  fontSignature: string;
  measurementRuntimeSignature: string;
};

let measurementOwners = new WeakMap<TableMeasure, CompletedTableMeasurementOwner>();
const measurementIdentities = new WeakMap<object, object>();
const immutableData = new WeakSet<object>();

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
  };
}

export function prepareTableMeasurementCell(owner: TableRowMeasurementOwner | null, cellIndex: number): void {
  if (!owner?.immutable) return;
  if (owner.alreadyCertified) return;
  const cell = owner.row.cells[cellIndex]!;
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
  owner.rowsCertified += 1;
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

export function recordTableMeasurementOwner(measure: TableMeasure, owner: TableMeasurementOwner | null): void {
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
    });
  }
}
