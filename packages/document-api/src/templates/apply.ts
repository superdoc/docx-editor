/**
 * `templates.apply`: source-authoritative template adoption (SD-3247).
 *
 * Adopts a source DOCX's template **style system and reusable template assets**
 * onto the currently open document while preserving the open document's
 * body/story content (`word/document.xml` is never replaced). This is template
 * adoption, not a blind substrate transplant. The adoption semantics are:
 *
 * - `styles`: source-authoritative overlap. For a `styleId` defined in both
 *   documents the source definition wins **in place** under the original id
 *   (no `*-tmpl` rename). The source `w:docDefaults` and `w:latentStyles`
 *   singletons replace the target's. Source-only styles are imported; target-only
 *   styles still required by preserved content are retained.
 * - `numbering`: reconciled as a dependency graph (not a flat append / blind
 *   replace). The `w:num`/`w:abstractNum` graph required by imported
 *   numbering-bearing styles is imported, colliding ids are remapped
 *   deterministically, and references are rewritten coherently in both
 *   `numbering.xml` and `styles.xml`.
 * - `settings`: bounded reconciliation — layout/style-affecting settings (e.g.
 *   default tab stop) are adopted; identity/workflow settings (`rsid*`, `docId`,
 *   protection/revision state, `attachedTemplate`) are preserved.
 * - `theme`, `fontTable`, `webSettings`: whole-part adoption.
 * - `headersFooters`: **all** source `header*.xml` / `footer*.xml` parts are
 *   imported as reusable template assets (even ones the page-1 governing
 *   section does not reference), together with their `.rels` and transitive
 *   media closure; colliding part names / relationship ids / media names are
 *   reallocated and references rewritten consistently.
 * - `sectionDefaults`: the source `w:sectPr` that governs page 1 is adopted as
 *   the current document's active/final section-default model. On multi-section
 *   targets, its header/footer visibility model (`headerReference`,
 *   `footerReference`, `w:titlePg`) is also propagated across the earlier
 *   sections without overwriting their own page geometry. Intermediate / later
 *   source sections are not imported.
 *
 * Selected non-body package sidecars (`customXml`, `docProps/custom.xml`,
 * comments, notes, people, keymap customizations, and `settings.xml.rels`) are
 * imported when present so reconstructed content can reuse the source package
 * substrate faithfully. Source body content, glossary, signatures, embeddings,
 * and body media remain out of scope and are reported, never applied.
 *
 * Engine-agnostic contract + execution entry point. No ProseMirror/converter imports.
 */

import { DocumentApiValidationError } from '../errors.js';
import { isRecord } from '../validation-primitives.js';

export type TemplatesApplySourcePath = { kind: 'path'; path: string };
export type TemplatesApplySourceBase64 = { kind: 'base64'; data: string; filename?: string };
export type TemplatesApplySource = TemplatesApplySourcePath | TemplatesApplySourceBase64;

export type TemplateBodyPolicy = 'preserve';

export type TemplateScope =
  | 'styles'
  | 'numbering'
  | 'settings'
  | 'theme'
  | 'fontTable'
  | 'webSettings'
  | 'headersFooters'
  | 'sectionDefaults';

export interface TemplatesApplyInput {
  source: TemplatesApplySource;
  bodyPolicy?: TemplateBodyPolicy;
}

export interface TemplatesApplyOptions {
  dryRun?: boolean;
  expectedRevision?: string | number;
}

export interface NormalizedTemplatesApplyOptions {
  dryRun: boolean;
  expectedRevision: string | undefined;
}

export interface TemplateScopeReport {
  scope: TemplateScope;
  part: string;
  detail?: string;
}

export type TemplateSkipReason = 'NOT_PRESENT_IN_SOURCE' | 'OUT_OF_SCOPE' | 'NO_CHANGE' | 'CAPABILITY_UNAVAILABLE';

export interface TemplateScopeSkip {
  scope: string;
  part?: string;
  reason: TemplateSkipReason;
  message: string;
}

export interface TemplateUnsupportedItem {
  part: string;
  category: string;
  reason: string;
}

export type TemplateChangeKind = 'created' | 'replaced' | 'merged' | 'imported';

export interface TemplateChangedPart {
  part: string;
  scope: TemplateScope | 'package';
  change: TemplateChangeKind;
}

export interface TemplateIdMapping {
  kind: 'style' | 'numbering' | 'relationship';
  from: string;
  to: string;
}

export interface TemplateApplyWarning {
  code: string;
  message: string;
}

export interface TemplatesApplySourceInfo {
  kind: 'path' | 'base64';
  fingerprint: string;
  partCount: number;
}

export interface TemplatesApplyReceiptSuccess {
  success: true;
  changed: boolean;
  dryRun: boolean;
  bodyPolicy: 'preserve';
  source: TemplatesApplySourceInfo;
  detectedScopes: TemplateScopeReport[];
  appliedScopes: TemplateScopeReport[];
  skippedScopes: TemplateScopeSkip[];
  unsupportedItems: TemplateUnsupportedItem[];
  changedParts: TemplateChangedPart[];
  idMappings: {
    styles?: TemplateIdMapping[];
    numbering?: TemplateIdMapping[];
    relationships?: TemplateIdMapping[];
  };
  warnings: TemplateApplyWarning[];
}

export type TemplatesApplyFailureCode =
  | 'UNSUPPORTED_SOURCE'
  | 'INVALID_PACKAGE'
  | 'CAPABILITY_UNAVAILABLE'
  | 'UNSUPPORTED_TEMPLATE_CONTENT';

export interface TemplatesApplyReceiptFailure {
  success: false;
  failure: { code: TemplatesApplyFailureCode; message: string };
}

export type TemplatesApplyReceipt = TemplatesApplyReceiptSuccess | TemplatesApplyReceiptFailure;

export interface TemplatesAdapter {
  /**
   * Adopt a source package's template substrate. Returns a Promise: the source
   * package is loaded asynchronously (JSZip), so the receipt resolves after the
   * async OPC read + mutation work completes. Pre-apply guards (converter
   * availability, `expectedRevision`) still throw synchronously before any
   * Promise is returned — see `throws.preApply` in the contract metadata.
   */
  apply(input: TemplatesApplyInput, options: NormalizedTemplatesApplyOptions): Promise<TemplatesApplyReceipt>;
}

export interface TemplatesApi {
  /**
   * Apply detected template substrate from a source DOCX onto the open document.
   *
   * Must be awaited: source acquisition and OPC/ZIP package loading are async.
   * Synchronous input validation and pre-apply preconditions still throw before
   * the returned Promise is created.
   */
  apply(input: TemplatesApplyInput, options?: TemplatesApplyOptions): Promise<TemplatesApplyReceipt>;
}

function normalizeOptions(options?: TemplatesApplyOptions): NormalizedTemplatesApplyOptions {
  if (options && 'changeMode' in options && options.changeMode === 'tracked') {
    throw new DocumentApiValidationError('CAPABILITY_UNAVAILABLE', 'templates.apply does not support tracked changes.');
  }
  return {
    dryRun: options?.dryRun ?? false,
    expectedRevision: options?.expectedRevision === undefined ? undefined : String(options.expectedRevision),
  };
}

function validateTemplatesApplyInput(input: TemplatesApplyInput): void {
  if (!isRecord(input)) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'templates.apply input must be a non-null object.');
  }

  const allowedKeys = new Set(['source', 'bodyPolicy']);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        `Unknown field "${key}" on templates.apply input. Allowed fields: ${[...allowedKeys].join(', ')}.`,
        { field: key },
      );
    }
  }

  const { source, bodyPolicy } = input as Record<string, unknown>;

  if (!isRecord(source)) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'templates.apply requires a source object.', {
      field: 'source',
      value: source,
    });
  }

  if (source.kind === 'path') {
    const sourceKeys = new Set(['kind', 'path']);
    for (const key of Object.keys(source)) {
      if (!sourceKeys.has(key)) {
        throw new DocumentApiValidationError(
          'INVALID_INPUT',
          `Unknown field "source.${key}". Allowed fields: ${[...sourceKeys].join(', ')}.`,
          { field: `source.${key}` },
        );
      }
    }
    if (typeof source.path !== 'string' || source.path.length === 0) {
      throw new DocumentApiValidationError('INVALID_INPUT', 'source.path must be a non-empty string.', {
        field: 'source.path',
        value: source.path,
      });
    }
  } else if (source.kind === 'base64') {
    const sourceKeys = new Set(['kind', 'data', 'filename']);
    for (const key of Object.keys(source)) {
      if (!sourceKeys.has(key)) {
        throw new DocumentApiValidationError(
          'INVALID_INPUT',
          `Unknown field "source.${key}". Allowed fields: ${[...sourceKeys].join(', ')}.`,
          { field: `source.${key}` },
        );
      }
    }
    if (typeof source.data !== 'string' || source.data.length === 0) {
      throw new DocumentApiValidationError('INVALID_INPUT', 'source.data must be a non-empty string.', {
        field: 'source.data',
        value: source.data,
      });
    }
    if (source.filename !== undefined && typeof source.filename !== 'string') {
      throw new DocumentApiValidationError('INVALID_INPUT', 'source.filename must be a string when present.', {
        field: 'source.filename',
        value: source.filename,
      });
    }
  } else {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `source.kind must be "path" or "base64", got ${JSON.stringify(source.kind)}.`,
      { field: 'source.kind', value: source.kind },
    );
  }

  if (bodyPolicy !== undefined && bodyPolicy !== 'preserve') {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `bodyPolicy must be "preserve" when present, got ${JSON.stringify(bodyPolicy)}.`,
      { field: 'bodyPolicy', value: bodyPolicy },
    );
  }
}

/**
 * Execute `templates.apply`.
 *
 * Input validation and option normalization run synchronously, so invalid
 * input and other `throws.preApply` cases still throw synchronously (before any
 * Promise is created). The successful/receipt-returning path is async: the
 * adapter loads the source package via the async OPC reader and resolves a
 * {@link TemplatesApplyReceipt}.
 */
export function executeTemplatesApply(
  adapter: TemplatesAdapter,
  input: TemplatesApplyInput,
  options?: TemplatesApplyOptions,
): Promise<TemplatesApplyReceipt> {
  validateTemplatesApplyInput(input);
  return adapter.apply(input, normalizeOptions(options));
}
