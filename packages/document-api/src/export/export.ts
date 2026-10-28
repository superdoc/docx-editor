/**
 * Export namespace: engine-agnostic public API and adapter contract.
 *
 * Validates the requested mode at the public boundary so an invalid mode fails
 * closed with `INVALID_INPUT` before any document work happens, then delegates
 * byte production and degradation reporting to the engine adapter.
 */

import { DocumentApiValidationError } from '../errors.js';
import {
  DEFAULT_SD_EXPORT_MODE,
  SD_EXPORT_MODES,
  SD_COMMENT_EXPORT_POLICIES,
  SD_CONTENT_CONTROL_EXPORT_POLICIES,
  type DocxExportPolicies,
  type ExportToDocxInput,
  type ExportToDocxResult,
  type SDExportMode,
} from './export.types.js';
import { isRecord } from '../object-guards.js';

// ---------------------------------------------------------------------------
// Adapter interface: implemented by each engine
// ---------------------------------------------------------------------------

export interface ExportAdapter {
  toDocx(input: { mode: SDExportMode; policies?: Required<DocxExportPolicies> }): ExportToDocxResult;
}

// ---------------------------------------------------------------------------
// Public API shape on DocumentApi
// ---------------------------------------------------------------------------

export interface ExportApi {
  toDocx(input?: ExportToDocxInput): ExportToDocxResult;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function resolveMode(input: ExportToDocxInput | undefined): SDExportMode {
  if (input != null && !isRecord(input)) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'export.toDocx input must be an object.');
  }
  const raw = input?.mode;
  if (raw === undefined) return DEFAULT_SD_EXPORT_MODE;
  if (typeof raw !== 'string' || !SD_EXPORT_MODES.includes(raw as SDExportMode)) {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `export.toDocx mode must be one of: ${SD_EXPORT_MODES.join(', ')}.`,
      { mode: raw, allowedModes: [...SD_EXPORT_MODES] },
    );
  }
  return raw as SDExportMode;
}

export function resolveDocxExportPolicies(input: ExportToDocxInput = {}): Required<DocxExportPolicies> {
  if (!isRecord(input)) throw new DocumentApiValidationError('INVALID_INPUT', 'DOCX export input must be an object.');
  const mode = resolveMode(input);
  const policies = input.policies;
  if (policies !== undefined && !isRecord(policies)) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'DOCX export policies must be an object.');
  }
  const allowed = {
    trackedChanges: SD_EXPORT_MODES,
    comments: SD_COMMENT_EXPORT_POLICIES,
    contentControls: SD_CONTENT_CONTROL_EXPORT_POLICIES,
  };
  for (const [key, value] of Object.entries(policies ?? {})) {
    if (
      !Object.prototype.hasOwnProperty.call(allowed, key) ||
      (value !== undefined && !(allowed[key as keyof typeof allowed] as readonly unknown[]).includes(value))
    ) {
      throw new DocumentApiValidationError('INVALID_INPUT', `Unsupported DOCX export policy: ${key}.`, {
        policy: key,
        value,
      });
    }
  }
  const requested = policies as DocxExportPolicies | undefined;
  if (input.mode !== undefined && requested?.trackedChanges !== undefined && mode !== requested.trackedChanges) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'mode conflicts with policies.trackedChanges.');
  }
  return {
    trackedChanges: requested?.trackedChanges ?? mode,
    comments: requested?.comments ?? 'preserve',
    contentControls: requested?.contentControls ?? 'preserve',
  };
}

// ---------------------------------------------------------------------------
// Execute function: bridge public API to adapter
// ---------------------------------------------------------------------------

export function executeExportToDocx(
  adapter: ExportAdapter | undefined,
  input: ExportToDocxInput = {},
): ExportToDocxResult {
  // Mode validation runs first so an invalid mode fails closed with
  // INVALID_INPUT regardless of adapter availability and before any work.
  const policies = resolveDocxExportPolicies(input);
  if (!adapter) {
    throw new DocumentApiValidationError('CAPABILITY_UNSUPPORTED', 'export.toDocx is not available in this runtime.');
  }
  return adapter.toDocx({ mode: policies.trackedChanges, policies });
}
