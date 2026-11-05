import { DocumentApiValidationError } from '../errors.js';
import { isRecord } from '../object-guards.js';
import { assertNoUnknownFields } from '../validation-primitives.js';
import { validateStoryLocator } from '../validation/story-validator.js';
import type {
  ChangeRecord,
  ChangesActorsResult,
  ChangesGetInput,
  ChangesListInput,
  ChangesListResult,
  ChangesResolveInput,
  ChangesResolveResult,
  ChangesSnapshotInput,
  ChangesSnapshotResult,
} from './changes.types.js';

export interface ChangesAdapter {
  list(input: ChangesListInput): Promise<ChangesListResult>;
  get(input: ChangesGetInput): Promise<ChangeRecord | null>;
  resolve(input: ChangesResolveInput): Promise<ChangesResolveResult>;
  actors(): Promise<ChangesActorsResult>;
  snapshot(input: ChangesSnapshotInput): Promise<ChangesSnapshotResult>;
}

export interface ChangesApi {
  list(input?: ChangesListInput): Promise<ChangesListResult>;
  get(input: ChangesGetInput): Promise<ChangeRecord | null>;
  resolve(input: ChangesResolveInput): Promise<ChangesResolveResult>;
  actors(): Promise<ChangesActorsResult>;
  snapshot(input?: ChangesSnapshotInput): Promise<ChangesSnapshotResult>;
}

export const CHANGES_LIST_LIMIT_MAX = 1000;
export const CHANGES_WAIT_MS_MAX = 30000;

const LIST_FIELDS: ReadonlySet<string> = new Set([
  'after',
  'limit',
  'story',
  'blockId',
  'actorId',
  'includeUpdate',
  'waitMs',
]);
const GET_FIELDS: ReadonlySet<string> = new Set(['id']);
const RESOLVE_FIELDS: ReadonlySet<string> = new Set(['blockId', 'limit']);
const SNAPSHOT_FIELDS: ReadonlySet<string> = new Set(['includeState']);

function invalid(message: string, field: string, value: unknown): never {
  throw new DocumentApiValidationError('INVALID_INPUT', message, {
    field,
    value,
  });
}

function inputRecord(input: unknown, operationName: string, optional: boolean): Record<string, unknown> {
  if (input === undefined && optional) return {};
  if (!isRecord(input)) {
    throw new DocumentApiValidationError('INVALID_INPUT', `${operationName} input must be a non-null object.`);
  }
  return input;
}

function validateNonEmptyString(value: unknown, field: string, operationName: string, optional: boolean): void {
  if (value === undefined && optional) return;
  if (typeof value !== 'string' || value.length === 0) {
    invalid(`${operationName} ${field} must be a non-empty string.`, field, value);
  }
}

function validateIntegerRange(
  value: unknown,
  field: string,
  operationName: string,
  minimum: number,
  maximum: number,
): void {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    invalid(`${operationName} ${field} must be an integer from ${minimum} to ${maximum}.`, field, value);
  }
}

function validateBoolean(value: unknown, field: string, operationName: string): void {
  if (value !== undefined && typeof value !== 'boolean') {
    invalid(`${operationName} ${field} must be a boolean.`, field, value);
  }
}

type ValidatedInput<T> = Record<string, unknown> & T;

function assertChangesListRecord(record: Record<string, unknown>): asserts record is ValidatedInput<ChangesListInput> {
  assertNoUnknownFields(record, LIST_FIELDS, 'changes.list');
  validateNonEmptyString(record.after, 'after', 'changes.list', true);
  validateIntegerRange(record.limit, 'limit', 'changes.list', 1, CHANGES_LIST_LIMIT_MAX);
  if (record.story !== undefined) {
    if (record.story === null) invalid('changes.list story must be a StoryLocator.', 'story', record.story);
    validateStoryLocator(record.story, 'story');
  }
  validateNonEmptyString(record.blockId, 'blockId', 'changes.list', true);
  validateNonEmptyString(record.actorId, 'actorId', 'changes.list', true);
  validateBoolean(record.includeUpdate, 'includeUpdate', 'changes.list');
  validateIntegerRange(record.waitMs, 'waitMs', 'changes.list', 0, CHANGES_WAIT_MS_MAX);
}

export function validateChangesListInput(input: unknown): ChangesListInput {
  const record = inputRecord(input, 'changes.list', true);
  assertChangesListRecord(record);
  return record;
}

function assertChangesGetRecord(record: Record<string, unknown>): asserts record is ValidatedInput<ChangesGetInput> {
  assertNoUnknownFields(record, GET_FIELDS, 'changes.get');
  validateNonEmptyString(record.id, 'id', 'changes.get', false);
}

export function validateChangesGetInput(input: unknown): ChangesGetInput {
  const record = inputRecord(input, 'changes.get', false);
  assertChangesGetRecord(record);
  return record;
}

function assertChangesResolveRecord(
  record: Record<string, unknown>,
): asserts record is ValidatedInput<ChangesResolveInput> {
  assertNoUnknownFields(record, RESOLVE_FIELDS, 'changes.resolve');
  validateNonEmptyString(record.blockId, 'blockId', 'changes.resolve', false);
  validateIntegerRange(record.limit, 'limit', 'changes.resolve', 1, CHANGES_LIST_LIMIT_MAX);
}

export function validateChangesResolveInput(input: unknown): ChangesResolveInput {
  const record = inputRecord(input, 'changes.resolve', false);
  assertChangesResolveRecord(record);
  return record;
}

function assertChangesSnapshotRecord(
  record: Record<string, unknown>,
): asserts record is ValidatedInput<ChangesSnapshotInput> {
  assertNoUnknownFields(record, SNAPSHOT_FIELDS, 'changes.snapshot');
  validateBoolean(record.includeState, 'includeState', 'changes.snapshot');
}

export function validateChangesSnapshotInput(input: unknown): ChangesSnapshotInput {
  const record = inputRecord(input, 'changes.snapshot', true);
  assertChangesSnapshotRecord(record);
  return record;
}

function requireChangesAdapter(adapter: ChangesAdapter | undefined, operationName: string): ChangesAdapter {
  if (!adapter) {
    throw new DocumentApiValidationError(
      'CAPABILITY_UNAVAILABLE',
      `${operationName} is not available. The host engine has not provided a changes adapter.`,
      { operation: operationName },
    );
  }
  return adapter;
}

export async function executeChangesList(
  adapter: ChangesAdapter | undefined,
  input?: ChangesListInput,
): Promise<ChangesListResult> {
  const request = validateChangesListInput(input);
  return requireChangesAdapter(adapter, 'changes.list').list(request);
}

export async function executeChangesGet(
  adapter: ChangesAdapter | undefined,
  input: ChangesGetInput,
): Promise<ChangeRecord | null> {
  const request = validateChangesGetInput(input);
  return requireChangesAdapter(adapter, 'changes.get').get(request);
}

export async function executeChangesResolve(
  adapter: ChangesAdapter | undefined,
  input: ChangesResolveInput,
): Promise<ChangesResolveResult> {
  const request = validateChangesResolveInput(input);
  return requireChangesAdapter(adapter, 'changes.resolve').resolve(request);
}

export async function executeChangesActors(adapter: ChangesAdapter | undefined): Promise<ChangesActorsResult> {
  return requireChangesAdapter(adapter, 'changes.actors').actors();
}

export async function executeChangesSnapshot(
  adapter: ChangesAdapter | undefined,
  input?: ChangesSnapshotInput,
): Promise<ChangesSnapshotResult> {
  const request = validateChangesSnapshotInput(input);
  return requireChangesAdapter(adapter, 'changes.snapshot').snapshot(request);
}
