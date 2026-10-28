/**
 * Public types for the modeful DOCX export contract.
 *
 * `export.toDocx` serializes the current document to DOCX bytes under an
 * explicit tracked-change export mode and returns the bytes plus the
 * structured degradation report. It is the engine-agnostic public boundary for
 * the §17 / §18 export-mode contract; the byte production and warning model
 * live in the engine adapter / shared serializer.
 */

import type { ReviewWarning } from '../types/receipt.js';

/** Canonical tracked-change export modes accepted by every public export surface. */
export const SD_EXPORT_MODES = ['review-preserving', 'final', 'original'] as const;

/**
 * Tracked-change export mode.
 *
 * - `review-preserving` (default): keep open tracked changes as Word revision
 *   markup so the saved document is still reviewable.
 * - `final`: resolve every open tracked change as accepted.
 * - `original`: resolve every open tracked change as rejected.
 */
export type SDExportMode = (typeof SD_EXPORT_MODES)[number];

/** Default mode for modeful DOCX export. */
export const DEFAULT_SD_EXPORT_MODE: SDExportMode = 'review-preserving';

export const SD_COMMENT_EXPORT_POLICIES = ['preserve', 'resolve', 'remove'] as const;
export const SD_CONTENT_CONTROL_EXPORT_POLICIES = ['preserve', 'flatten'] as const;

export interface DocxExportPolicies {
  trackedChanges?: SDExportMode;
  comments?: (typeof SD_COMMENT_EXPORT_POLICIES)[number];
  contentControls?: (typeof SD_CONTENT_CONTROL_EXPORT_POLICIES)[number];
}

/** Input for `export.toDocx`. */
export interface ExportToDocxInput {
  /** Tracked-change export mode. Defaults to `review-preserving`. */
  mode?: SDExportMode;
  policies?: DocxExportPolicies;
}

/** Structured degradation report for an export. */
export interface ExportToDocxReport {
  /**
   * Allowed, non-load-bearing degradation warnings produced while projecting
   * the document for the requested mode (for example a tracked replacement
   * exported as Word delete+insert). Forbidden semantic loss never reaches
   * this lane — those failures fail closed before bytes are produced.
   */
  warnings: ReviewWarning[];
}

/** Result of `export.toDocx`. */
export interface ExportToDocxResult {
  /** The mode the export was produced under. */
  mode: SDExportMode;
  /** Byte length of the exported DOCX package. */
  byteLength: number;
  /** Base64-encoded exported DOCX package bytes. */
  contentBase64: string;
  /** Degradation report for the export. */
  report: ExportToDocxReport;
}
