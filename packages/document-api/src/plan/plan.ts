// plan.execute - host-side batch executor (recipe-replay Workstream A).
//
// Replay-style clients compile maximal runs of operation invocations into one
// `plan.execute` call instead of one round trip per operation. The executor
// preserves STEPWISE semantics exactly:
//   - per-entry execution through the normal dynamic dispatch (never one
//     atomic transaction across entries);
//   - host-side capture resolution between entries (capture-ref /
//     project-text-offset markers, including markers nested inside `where`);
//   - keep-prefix-and-continue on allowed/expected failures, stop on the
//     first hard failure (reported in `failure`, prior effects retained);
//   - capture projection: only `captureReturns` keys travel back to the
//     client ('*' returns the full capture map).
//
// The reference implementation these semantics must match byte-for-byte lives
// in the recipe-replay client (`replay-batched.test.ts`); its capture-selector
// and text-offset projections are ported verbatim below.

import { DocumentApiValidationError } from '../errors.js';
import { OPERATION_BATCHABLE_MAP } from '../contract/command-catalog.js';
import { isOperationId } from '../contract/types.js';

export interface PlanCaptureRefMarker {
  kind: 'capture-ref';
  captureKey: string;
  /** Dotted lookup path into the captured value (supports array indices and `length`). */
  path?: string;
  /** Structural filter applied to an array at `path`; may nest further markers. */
  where?: unknown;
  /** Index into the (filtered) array; negative counts from the end. */
  occurrence?: number;
  /** Dotted lookup applied after `where`/`occurrence` selection. */
  selectPath?: string;
}

export interface PlanProjectTextOffsetMarker {
  kind: 'project-text-offset';
  rawText: string;
  rawOffset: number;
  publicText: string | PlanCaptureRefMarker;
}

export interface PlanExecuteEntryExpect {
  /** `false` marks the entry as an expected failure. */
  success?: boolean;
  failureCode?: string;
  failureMessageIncludes?: string;
  allowFailureMessageIncludes?: string;
}

export interface PlanExecuteEntry {
  operationId: string;
  input?: unknown;
  options?: unknown;
  captureAs?: string;
  expect?: PlanExecuteEntryExpect;
}

export interface PlanExecuteInput {
  entries: PlanExecuteEntry[];
  /** Capture keys to return to the client, or '*' for the full capture map. */
  captureReturns?: '*' | string[];
}

export type PlanEntryReceiptStatus = 'passed' | 'allowed-failure' | 'expected-failure';

export interface PlanEntryReceipt {
  entryIndex: number;
  operationId: string;
  status: PlanEntryReceiptStatus;
  captureAs: string | null;
  error?: string;
}

export interface PlanExecuteFailure {
  entryIndex: number;
  operationId: string;
  message: string;
}

export interface PlanExecuteResult {
  receipts: PlanEntryReceipt[];
  captures: Record<string, unknown>;
  failure?: PlanExecuteFailure;
}

export interface PlanApi<TExecuteResult = PlanExecuteResult> {
  /**
   * Execute a compiled run of operation entries with host-side capture
   * resolution. Capture state persists across `plan.execute` calls within the
   * same document session, so chunked plans share one capture space.
   */
  execute(input: PlanExecuteInput): TExecuteResult;
}

type DynamicInvoke = (operationId: string, input: unknown, options: unknown) => unknown;
type AsyncDynamicInvoke = (operationId: string, input: unknown, options: unknown) => PromiseLike<unknown>;

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    Boolean(value) &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function isAsyncFunction(value: unknown): boolean {
  return typeof value === 'function' && Object.prototype.toString.call(value) === '[object AsyncFunction]';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isCaptureRef(value: unknown): value is PlanCaptureRefMarker {
  const record = asRecord(value);
  return !!record && record.kind === 'capture-ref' && typeof record.captureKey === 'string';
}

function isProjectedTextOffset(value: unknown): value is PlanProjectTextOffsetMarker {
  const record = asRecord(value);
  return (
    !!record &&
    record.kind === 'project-text-offset' &&
    typeof record.rawText === 'string' &&
    typeof record.rawOffset === 'number' &&
    (typeof record.publicText === 'string' || isCaptureRef(record.publicText))
  );
}

function isClientAssetMarker(value: unknown): boolean {
  const record = asRecord(value);
  return (
    !!record &&
    (record.kind === 'asset-ref' || record.kind === 'asset-path' || record.kind === 'asset-base64') &&
    typeof record.relativePath === 'string'
  );
}

// -- capture selectors (ported verbatim from the replay client) --------------

function lookupCapturePath(root: unknown, dottedPath: string | undefined): unknown {
  if (!dottedPath) return root;
  const segments = dottedPath.split('.').filter(Boolean);
  let cursor: unknown = root;
  for (const segment of segments) {
    if (cursor === null || typeof cursor === 'undefined') return undefined;
    if (segment === 'length' && (typeof cursor === 'string' || Array.isArray(cursor))) {
      cursor = cursor.length;
      continue;
    }
    if (Array.isArray(cursor)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      cursor = cursor[index];
      continue;
    }
    if (typeof cursor === 'object') {
      cursor = (cursor as Record<string, unknown>)[segment];
      continue;
    }
    return undefined;
  }
  return cursor;
}

function matchesCaptureWhere(candidate: unknown, where: unknown): boolean {
  if (Array.isArray(where)) {
    if (!Array.isArray(candidate) || candidate.length !== where.length) return false;
    for (const [index, entry] of where.entries()) {
      if (!matchesCaptureWhere(candidate[index], entry)) return false;
    }
    return true;
  }
  const whereRecord = asRecord(where);
  if (whereRecord) {
    const candidateRecord = asRecord(candidate);
    if (!candidateRecord) return false;
    for (const [key, value] of Object.entries(whereRecord)) {
      if (!matchesCaptureWhere(candidateRecord[key], value)) return false;
    }
    return true;
  }
  return Object.is(candidate, where);
}

function resolveCaptureReference(root: unknown, marker: PlanCaptureRefMarker): unknown {
  let cursor = lookupCapturePath(root, marker.path);
  if (typeof cursor === 'undefined') return undefined;
  if (typeof marker.where !== 'undefined') {
    if (!Array.isArray(cursor)) return undefined;
    const filtered = cursor.filter((entry) => matchesCaptureWhere(entry, marker.where));
    const occurrence = marker.occurrence ?? 0;
    const index = occurrence >= 0 ? occurrence : filtered.length + occurrence;
    cursor = filtered[index];
  } else if (typeof marker.occurrence === 'number') {
    if (!Array.isArray(cursor)) return undefined;
    const index = marker.occurrence >= 0 ? marker.occurrence : cursor.length + marker.occurrence;
    cursor = cursor[index];
  }
  return lookupCapturePath(cursor, marker.selectPath);
}

// -- raw-to-public text offset projection (ported verbatim) ------------------

function isPlaceholderCharacter(value: string | null): boolean {
  if (value === null || value.length === 0) return false;
  const codePoint = value.codePointAt(0);
  return typeof codePoint === 'number' && codePoint >= 0xe000 && codePoint <= 0xf8ff;
}

function projectRawOffsetToPublicText(rawText: string, publicText: string, rawOffset: number): number | null {
  if (rawOffset < 0 || rawOffset > rawText.length) return null;
  let rawIndex = 0;
  let publicIndex = 0;
  while (rawIndex < rawOffset && rawIndex < rawText.length) {
    const rawChar = rawText[rawIndex]!;
    const publicChar = publicText[publicIndex] ?? null;
    if (publicChar !== null && (rawChar === publicChar || isPlaceholderCharacter(publicChar))) {
      rawIndex += 1;
      publicIndex += 1;
      continue;
    }
    rawIndex += 1;
  }
  return Math.min(publicIndex, publicText.length);
}

// -- capture normalization (mirrors the SDK-client result shaping) -----------

function unwrapResultEnvelope(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  const record = value as Record<string, unknown>;
  if ('undefined' in record && record.undefined && typeof record.undefined === 'object') {
    return record.undefined as Record<string, unknown>;
  }
  if (record.result && typeof record.result === 'object') return record.result as Record<string, unknown>;
  if (record.receipt && typeof record.receipt === 'object') return record.receipt as Record<string, unknown>;
  return record;
}

function normalizeCapturedResult(value: unknown): unknown {
  const rawRecord = asRecord(value);
  if (!rawRecord) return value;
  const payload = unwrapResultEnvelope(value);
  const payloadRecord = asRecord(payload);
  if (!payloadRecord || payloadRecord === rawRecord) return value;
  return { ...rawRecord, ...payloadRecord, __raw: rawRecord };
}

// -- marker substitution (capture/text-offset only; assets are client-side) --

function substitutePlanMarkers(value: unknown, captures: Record<string, unknown>): unknown {
  if (isClientAssetMarker(value)) {
    throw new Error(
      'plan.execute entries must have asset markers resolved client-side before dispatch; ' +
        `received unresolved "${(value as { kind: string }).kind}" marker`,
    );
  }
  if (isCaptureRef(value)) {
    const resolvedWhere = typeof value.where === 'undefined' ? undefined : substitutePlanMarkers(value.where, captures);
    const root = captures[value.captureKey];
    const marker: PlanCaptureRefMarker = { kind: 'capture-ref', captureKey: value.captureKey };
    if (typeof value.path !== 'undefined') marker.path = value.path;
    if (typeof resolvedWhere !== 'undefined') marker.where = resolvedWhere;
    if (typeof value.occurrence !== 'undefined') marker.occurrence = value.occurrence;
    if (typeof value.selectPath !== 'undefined') marker.selectPath = value.selectPath;
    const resolved = resolveCaptureReference(root, marker);
    if (typeof resolved === 'undefined') {
      throw new Error(`capture-ref "${value.captureKey}" path "${value.path ?? '<root>'}" resolved to undefined`);
    }
    return resolved;
  }
  if (isProjectedTextOffset(value)) {
    const publicText = substitutePlanMarkers(value.publicText, captures);
    if (typeof publicText !== 'string') {
      throw new Error('project-text-offset publicText must resolve to a string');
    }
    const resolved = projectRawOffsetToPublicText(value.rawText, publicText, value.rawOffset);
    if (resolved === null) {
      throw new Error(
        `project-text-offset rawOffset ${value.rawOffset} is outside rawText length ${value.rawText.length}`,
      );
    }
    return resolved;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => substitutePlanMarkers(entry, captures));
  }
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = substitutePlanMarkers(entry, captures);
  }
  return out;
}

// -- failed-receipt detection (mirrors the node SDK client) ------------------
//
// Document-api mutations report most failures by RETURNING
// `{ success: false, failure: { code, message } }` rather than throwing. In
// stepwise mode the SDK client converts such receipts into thrown errors
// (`extractFailedReceiptError`, packages/sdk/langs/node/src/runtime/host.ts),
// so replay classification only ever sees throws. The executor must do the
// same conversion or a failed entry would be recorded `passed`, its receipt
// stored as a capture, and every downstream capture-ref would die.

interface FailedReceiptRecord {
  success: false;
  failure?: { code?: unknown; message?: unknown };
}

function isFailedReceiptRecord(value: unknown): value is FailedReceiptRecord {
  const record = asRecord(value);
  return !!record && record.success === false && 'failure' in record;
}

function findFailedReceipt(value: unknown): FailedReceiptRecord | null {
  if (isFailedReceiptRecord(value)) return value;
  const record = asRecord(value);
  if (!record) return null;
  for (const nested of Object.values(record)) {
    if (isFailedReceiptRecord(nested)) return nested;
  }
  return null;
}

/**
 * Error shape equivalent to the SDK client's failed-receipt throw: message =
 * failure.message, `.code` = raw failure.code, `.details.failure` preserved.
 *
 * AIDEV-NOTE: the SDK additionally remaps some codes per operation family
 * (`mapFailedReceiptCode`); the canonical mapping lives in
 * apps/cli/src/lib/error-mapping.ts + the SDK runtime and cannot be imported
 * here (dependency direction). Raw codes are used for `expect.failureCode`
 * comparison; if a replay corpus surfaces a remapped-family mismatch, port
 * those specific pairs into a documented table here.
 */
function failedReceiptToError(receipt: FailedReceiptRecord): Error {
  const failure = asRecord(receipt.failure) ?? {};
  const message =
    typeof failure.message === 'string' && failure.message.length > 0 ? failure.message : 'Command failed.';
  const error = new Error(message) as Error & { code?: string; details?: unknown };
  if (typeof failure.code === 'string' && failure.code.length > 0) {
    error.code = failure.code;
  }
  error.details = { failure: receipt.failure };
  return error;
}

// -- failure classification (mirrors the stepwise replay client) -------------

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCodeOf(error: unknown): string | null {
  const record = error as { code?: unknown; details?: { code?: unknown } } | null;
  if (record && typeof record.code === 'string') return record.code;
  if (record && record.details && typeof record.details.code === 'string') return record.details.code;
  return null;
}

function matchesAllowedFailure(expect: PlanExecuteEntryExpect | undefined, error: unknown): boolean {
  if (expect?.success === false) return false;
  if (!expect?.allowFailureMessageIncludes) return false;
  return errorMessageOf(error).includes(expect.allowFailureMessageIncludes);
}

function matchesExpectedFailure(expect: PlanExecuteEntryExpect | undefined, error: unknown): boolean {
  if (expect?.success !== false) return false;
  if (expect.failureCode && errorCodeOf(error) !== expect.failureCode) return false;
  if (expect.failureMessageIncludes && !errorMessageOf(error).includes(expect.failureMessageIncludes)) {
    return false;
  }
  return true;
}

function validatePlanExecuteInput(input: PlanExecuteInput): void {
  if (!input || !Array.isArray(input.entries)) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'plan.execute requires input.entries to be an array.');
  }
  if (
    typeof input.captureReturns !== 'undefined' &&
    input.captureReturns !== '*' &&
    (!Array.isArray(input.captureReturns) || input.captureReturns.some((key) => typeof key !== 'string'))
  ) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'plan.execute captureReturns must be "*" or an array of strings.',
    );
  }
  for (const [entryIndex, entry] of input.entries.entries()) {
    const record = asRecord(entry);
    const operationId = record?.operationId;
    if (typeof operationId !== 'string' || operationId.length === 0) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `plan.execute entry ${entryIndex} requires a non-empty operationId string.`,
        { entryIndex },
      );
    }
    if (isOperationId(operationId) && !OPERATION_BATCHABLE_MAP[operationId]) {
      throw new DocumentApiValidationError(
        'CAPABILITY_UNAVAILABLE',
        `plan.execute does not support batching "${operationId}". Run it stepwise outside the plan.`,
        { entryIndex, operationId },
      );
    }
  }
}

/**
 * Build the `plan` namespace bound to one document session's dynamic dispatch.
 * The capture map lives in this closure, so it persists across chunked
 * `plan.execute` calls for the lifetime of the owning DocumentApi instance.
 */
export function createPlanApi(invoke: AsyncDynamicInvoke): PlanApi<Promise<PlanExecuteResult>>;
export function createPlanApi(invoke: DynamicInvoke): PlanApi;
export function createPlanApi(invoke: DynamicInvoke): PlanApi<PlanExecuteResult | Promise<PlanExecuteResult>> {
  const captures: Record<string, unknown> = {};
  // Empty plans and input validation run before any invoke return can be sampled,
  // so only native async functions can be forced through the async path up front.
  const forceAsync = isAsyncFunction(invoke);
  return {
    execute(input: PlanExecuteInput): PlanExecuteResult | Promise<PlanExecuteResult> {
      const executePlan = (): PlanExecuteResult | Promise<PlanExecuteResult> => {
        validatePlanExecuteInput(input);
        const captureReturns = input.captureReturns ?? [];
        const receipts: PlanEntryReceipt[] = [];
        let failure: PlanExecuteFailure | undefined;

        const finish = (): PlanExecuteResult => {
          const projectedCaptures =
            captureReturns === '*'
              ? { ...captures }
              : Object.fromEntries(captureReturns.filter((key) => key in captures).map((key) => [key, captures[key]]));
          return { receipts, captures: projectedCaptures, ...(failure ? { failure } : {}) };
        };

        const applyResult = (entryIndex: number, entry: PlanExecuteEntry, result: unknown): void => {
          const failedReceipt = findFailedReceipt(result);
          if (failedReceipt) {
            // Stepwise parity: the SDK converts returned failure receipts into
            // throws before replay classification ever sees them.
            throw failedReceiptToError(failedReceipt);
          }
          if (entry.captureAs) {
            captures[entry.captureAs] = normalizeCapturedResult(result);
          }
          receipts.push({
            entryIndex,
            operationId: entry.operationId,
            status: 'passed',
            captureAs: entry.captureAs ?? null,
          });
        };

        const handleError = (entryIndex: number, entry: PlanExecuteEntry, error: unknown): boolean => {
          const message = errorMessageOf(error);
          if (matchesAllowedFailure(entry.expect, error)) {
            receipts.push({
              entryIndex,
              operationId: entry.operationId,
              status: 'allowed-failure',
              captureAs: entry.captureAs ?? null,
              error: message,
            });
            return true;
          }
          if (matchesExpectedFailure(entry.expect, error)) {
            if (entry.captureAs) {
              captures[entry.captureAs] = { error: message };
            }
            receipts.push({
              entryIndex,
              operationId: entry.operationId,
              status: 'expected-failure',
              captureAs: entry.captureAs ?? null,
              error: message,
            });
            return true;
          }
          failure = { entryIndex, operationId: entry.operationId, message };
          return false;
        };

        const invokeEntry = (entry: PlanExecuteEntry): unknown => {
          const resolvedInput = substitutePlanMarkers(entry.input, captures);
          const resolvedOptions = substitutePlanMarkers(entry.options, captures);
          return invoke(entry.operationId, resolvedInput, resolvedOptions);
        };

        const continueAsync = async (
          pendingResult: PromiseLike<unknown>,
          pendingIndex: number,
          pendingEntry: PlanExecuteEntry,
        ): Promise<PlanExecuteResult> => {
          try {
            applyResult(pendingIndex, pendingEntry, await pendingResult);
          } catch (error) {
            if (!handleError(pendingIndex, pendingEntry, error)) return finish();
          }
          for (let entryIndex = pendingIndex + 1; entryIndex < input.entries.length; entryIndex += 1) {
            const entry = input.entries[entryIndex]!;
            try {
              applyResult(entryIndex, entry, await invokeEntry(entry));
            } catch (error) {
              if (!handleError(entryIndex, entry, error)) break;
            }
          }
          return finish();
        };

        for (const [entryIndex, entry] of input.entries.entries()) {
          try {
            const result = invokeEntry(entry);
            if (isPromiseLike(result)) {
              return continueAsync(result, entryIndex, entry) as never;
            }
            applyResult(entryIndex, entry, result);
          } catch (error) {
            if (!handleError(entryIndex, entry, error)) break;
          }
        }
        return finish();
      };

      return forceAsync ? Promise.resolve().then(executePlan) : executePlan();
    },
  };
}
