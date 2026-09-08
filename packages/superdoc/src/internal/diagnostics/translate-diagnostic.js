/**
 * Translates internal v2-kernel diagnostics into the public
 * `SuperDocExceptionDiagnosticPayload` taxonomy (`SuperDocDiagnosticCode` /
 * `SuperDocDiagnosticStage`), per the SuperDoc Diagnostics MVP design.
 *
 * Duck-types on `.code`/`.severity`/`.message` from data already crossing
 * the Vue-emit boundary (`SDDiagnosticRecord`-shaped, `V2RenderReadinessDiagnostic`-shaped,
 * or plain boot-failure reason strings) — this package does not depend on
 * `editor-core`/`v2-host` types directly.
 *
 * Every function returns `null` for anything intentionally out of scope for
 * the MVP; callers fall back to whatever legacy behavior already exists
 * (e.g. the `SuperDocExceptionEditorPayload.code` passthrough for boot
 * failures) and must not treat `null` as an error.
 */

/** @typedef {'PARSE_ERROR'|'RENDER_ERROR'|'UNSUPPORTED_FEATURE'|'PERFORMANCE_ERROR'} SuperDocDiagnosticCode */
/** @typedef {'unzip'|'parse'|'layout'|'render'|'export'} SuperDocDiagnosticStage */

/** @typedef {import('../../core/types/index.js').Editor} Editor */

/**
 * @typedef {object} SuperDocExceptionDiagnosticPayload
 * @property {unknown} error
 * @property {SuperDocDiagnosticCode} diagnosticCode
 * @property {SuperDocDiagnosticStage} diagnosticStage
 * @property {'warn'|'error'} severity
 * @property {string} internalCode
 * @property {string|null} [documentId]
 * @property {Editor|null} [editor]
 * @property {string} message
 */

/**
 * @typedef {object} DiagnosticTranslationContext
 * @property {string|null} [documentId]
 * @property {Editor|null} [editor]
 */

// Package-open codes that are size/count/depth caps, not content-integrity
// failures — see superdoc/v2/editor-core/src/opc/package-open.ts.
const UNZIP_PAYLOAD_CODE_PREFIX = 'PKG-payload-';

// Package-open `warn`-severity codes that are functionally a feature gap a
// customer should still see, even though they're not `error`-severity.
const UNZIP_WARN_ALLOW_LIST = new Set(['main-document-fallback']);

// Package-open codes that stay internal (relationship bookkeeping) unless
// they escalate to `error` severity.
const UNZIP_INTERNAL_ONLY_CODES = new Set([
  'dangling-content-type-override',
  'dangling-internal-relationship',
  'relationship-id-collision',
  'parts-not-referenced-from-known-rels',
]);

/**
 * Translates a `SDDiagnosticRecord`-shaped object (package-open / unzip
 * stage) into a public diagnostic payload, or `null` if out of scope.
 *
 * @param {{code?: string, severity?: string, message?: string}} record
 * @param {DiagnosticTranslationContext} [ctx]
 * @returns {SuperDocExceptionDiagnosticPayload | null}
 */
export function translateUnzipDiagnostic(record, ctx = {}) {
  if (!record || typeof record.code !== 'string') return null;
  const { code, severity, message } = record;

  const isError = severity === 'error';
  const isAllowedWarn = severity === 'warn' && UNZIP_WARN_ALLOW_LIST.has(code);
  if (!isError && !isAllowedWarn) return null;
  if (UNZIP_INTERNAL_ONLY_CODES.has(code) && !isError) return null;

  const diagnosticCode = code.startsWith(UNZIP_PAYLOAD_CODE_PREFIX) ? 'PERFORMANCE_ERROR' : 'PARSE_ERROR';

  return {
    error: new Error(message || code),
    diagnosticCode,
    diagnosticStage: 'unzip',
    severity: isError ? 'error' : 'warn',
    internalCode: code,
    documentId: ctx.documentId ?? null,
    editor: ctx.editor ?? null,
    message: message || code,
  };
}

/**
 * Translates a `V2RenderReadinessDiagnostic`-shaped object (render stage)
 * into a public diagnostic payload, or `null` if out of scope.
 *
 * @param {{code?: string, reason?: string, severity?: string}} diag
 * @param {DiagnosticTranslationContext} [ctx]
 * @returns {SuperDocExceptionDiagnosticPayload | null}
 */
export function translateRenderReadinessDiagnostic(diag, ctx = {}) {
  if (!diag || typeof diag.code !== 'string') return null;
  const { code, reason, severity } = diag;
  if (severity !== 'error' && severity !== 'warn') return null;

  // Classify by code first, then gate by severity per bucket. The real
  // producers (render-readiness.ts) emit `page-geometry.failed`,
  // `section-metadata.failed`, and `page-furniture.failed` at `warn`, not
  // `error` — filtering all non-'degraded' warns out before classification
  // would silently drop every one of these genuine render failures.
  // `render.exact-content-hydration-failed` (render-surface.ts
  // emitRollbackDiagnostic) fires on a self-healing paint rollback/retry --
  // confirmed by render-surface-persistent-failure-recovery.test.ts, where
  // page shells stay mounted/connected and a subsequent repaint succeeds and
  // hydrates. It is not a genuine unsupported-feature signal and must not be
  // promoted; doing so would raise a false customer-facing UNSUPPORTED_FEATURE
  // for a transient, already-recovered condition.
  if (code === 'render.exact-content-hydration-failed') return null;

  let diagnosticCode;
  if (
    code.includes('page-geometry.failed') ||
    code.includes('section-metadata.failed') ||
    code.includes('page-furniture.failed') ||
    // Confirmed by manual testing: fired from the `onPageFurnitureDiagnostic`
    // pathway (render-surface.ts) at severity 'warn', separate from the
    // markPage*/markSectionMetadataStatus pathway above -- a genuine render
    // pipeline failure ("projectBodyWindow failed: ..."), not internal noise.
    code === 'render.provider-error'
  ) {
    diagnosticCode = 'RENDER_ERROR';
  } else if (code.includes('unsupported')) {
    diagnosticCode = 'UNSUPPORTED_FEATURE';
  } else if (code.includes('degraded')) {
    // `render.engine-pass-degraded`/`render.scheduler-degraded` are
    // pass-through wrappers (render-surface.ts's `emitEnginePassFailure`,
    // the scheduler's `#enterDegraded`) around whatever the engine pass or
    // scheduler actually failed with. That underlying `reason` is either a
    // genuine capacity/timeout condition (retry-budget exhaustion, watchdog
    // timers -- legitimately PERFORMANCE_ERROR) or one of ~40 defensive
    // invariant-assertion `Error`s thrown by retained-state.ts (id
    // collisions, immutable-index writes, stale/incomplete indexes -- a
    // correctness bug, not a performance condition). retained-state.ts's own
    // message vocabulary ("retained ...", "localized resolve ...") survives
    // even after the scheduler wraps it with a retry-count prefix, so match
    // on it to reclassify those as RENDER_ERROR; anything else keeps the
    // PERFORMANCE_ERROR default.
    const isRetainedStateInvariant =
      typeof reason === 'string' && (reason.includes('retained ') || reason.includes('localized resolve '));
    diagnosticCode = isRetainedStateInvariant ? 'RENDER_ERROR' : 'PERFORMANCE_ERROR';
  } else if (severity === 'error') {
    diagnosticCode = 'RENDER_ERROR';
  } else {
    return null;
  }

  const message = reason || code;
  return {
    error: new Error(message),
    diagnosticCode,
    diagnosticStage: 'render',
    severity,
    internalCode: code,
    documentId: ctx.documentId ?? null,
    editor: ctx.editor ?? null,
    message,
  };
}

// Render `Error` subclasses that reach `boot()` catch sites without a
// `.code` field (see superdoc/v2/v2-host/src/render-surface.ts). Matched by
// `.name`, which the shell forwards as `bootErrorName`.
const BOOT_ERROR_NAME_TO_DIAGNOSTIC = {
  OpenRenderNoProgressError: 'PERFORMANCE_ERROR',
  BoundedLocalPageCapError: 'PERFORMANCE_ERROR',
  MountedEnginePassInterrupt: 'RENDER_ERROR',
};

// Boot-failure `reason` strings promoted to the public taxonomy.
//
// `source-load-failed` IS a genuine unzip/package-integrity failure, not a
// transport issue: it is set exclusively when `readiness.readiness ===
// 'blocked'` (create-v2-editor-host.ts), and `OpenResult.status === 'blocked'`
// is set exclusively for a hard package-invariant failure or a non-zip
// container (editor-core/src/open/v2-open.ts, editor-core/src/opc/package-open-source.ts)
// -- confirmed by manual testing: uploading a non-zip ".docx" reliably
// surfaces as `source-load-failed`, not `open-failed`, under the default
// worker execution mode. Excluding it left PARSE_ERROR unreachable for the
// most common real corrupt-document case.
//
// `worker-init-failed` stays excluded: per its `V2HostWorkerFailureDetail`
// doc comment (v2-host/src/events.ts), it means the worker itself failed to
// boot, before any document bytes are processed -- genuinely unrelated to
// document content. All other reasons (`collaboration-*`,
// `'v2-integration-unavailable'`, `'dispose-failed'`, etc.) stay excluded
// too.
//
// `'input-too-large-for-inline-review'` IS promoted (as PERFORMANCE_ERROR,
// handled separately below, not via this generic PARSE_ERROR allow-list): a
// document that exceeds the inline-review size threshold is a genuine
// capacity limit, not a content-integrity failure -- see
// `normalizeOpenInput()` (v2-host/src/input-normalization.ts) and its
// `setBlocked('input-too-large-for-inline-review', ...)` caller
// (create-v2-editor-host.ts).
//
// Deliberately also excluded: `V2EditorHostError`'s operational reasons
// (`'save-in-progress'`, `'open-in-progress'`, `'host-not-ready'`,
// create-v2-editor-host.ts) -- these are normal timing/concurrency
// conditions (e.g. `replaceFile()` called while a save is still in flight),
// never a document/package problem. Do not add them here: doing so would
// report "document is corrupted" for a document that never had anything
// wrong with it.
const BOOT_REASON_ALLOW_LIST = new Set(['open-failed', 'source-load-failed']);

// Boot-failure reasons that are a capacity/size limit rather than a
// content-integrity failure. Unlike `BOOT_REASON_ALLOW_LIST`, this is a
// hard blocked-open condition (the document never opens -- see
// `normalizeOpenInput()`/`setBlocked()` above), so `severity` stays
// `'error'` here too, matching `open-failed`/`source-load-failed`; a
// consumer filtering on `severity` to tell "didn't open" apart from "opened
// with a caveat" must still see `'error'`.
const BOOT_REASON_PERFORMANCE_MAP = new Map([['input-too-large-for-inline-review', 'unzip']]);

/**
 * Translates a boot/open failure into a public diagnostic payload, or
 * `null` if out of scope.
 *
 * `bootErrorName`, when present, takes precedence over `reason` — several
 * `boot()` catch sites in `V2SuperEditor.vue` hardcode `reason: 'open-failed'`
 * regardless of which error was actually thrown, so `reason` alone is not a
 * reliable signal once a real caught-error name is available.
 *
 * @param {string} reason
 * @param {string|null} [detail]
 * @param {DiagnosticTranslationContext & {bootErrorName?: string}} [ctx]
 * @returns {SuperDocExceptionDiagnosticPayload | null}
 */
export function translateBootFailureReason(reason, detail, ctx = {}) {
  const { bootErrorName, documentId, editor } = ctx;

  if (bootErrorName && BOOT_ERROR_NAME_TO_DIAGNOSTIC[bootErrorName]) {
    const message = detail || bootErrorName;
    return {
      error: new Error(message),
      diagnosticCode: BOOT_ERROR_NAME_TO_DIAGNOSTIC[bootErrorName],
      diagnosticStage: 'render',
      severity: 'error',
      internalCode: bootErrorName,
      documentId: documentId ?? null,
      editor: editor ?? null,
      message,
    };
  }

  if (BOOT_REASON_PERFORMANCE_MAP.has(reason)) {
    const message = detail || reason;
    return {
      error: new Error(message),
      diagnosticCode: 'PERFORMANCE_ERROR',
      diagnosticStage: BOOT_REASON_PERFORMANCE_MAP.get(reason),
      severity: 'error',
      internalCode: reason,
      documentId: documentId ?? null,
      editor: editor ?? null,
      message,
    };
  }

  if (!BOOT_REASON_ALLOW_LIST.has(reason)) return null;

  const message = detail || reason;
  return {
    error: new Error(message),
    diagnosticCode: 'PARSE_ERROR',
    diagnosticStage: 'unzip',
    severity: 'error',
    internalCode: reason,
    documentId: documentId ?? null,
    editor: editor ?? null,
    message,
  };
}

// SSIG-* codes (superdoc/v2/editor-core/src/document/source-signals/diagnostics.ts)
// that represent a genuine parse failure of a source-signal-relevant part,
// as opposed to relationship-bookkeeping/heuristic-classification codes in
// the same SSIG namespace. Explicit allow-list, not a prefix/suffix match,
// so an unrelated future SSIG-* code can't silently leak into onException.
const SSIG_PARSE_ERROR_CODES = new Set([
  'SSIG-SECT-parse-error',
  'SSIG-PAGE-parse-error',
  'SSIG-SETTINGS-parse-error',
  'SSIG-USAGE-body-parse-error',
  'SSIG-USAGE-numbering-parse-error',
]);

/**
 * Translates a `SDDiagnosticRecord`-shaped source-signals diagnostic (parse
 * stage) into a public diagnostic payload, or `null` if out of scope.
 *
 * `error`-severity only, unlike `translateUnzipDiagnostic`'s allow-listed
 * warns: every `*-parse-error` code in `SSIG_PARSE_ERROR_CODES` is also
 * emitted at `warn` for soft/summary conditions that are NOT a genuine parse
 * failure -- e.g. `SSIG-SETTINGS-parse-error` warns on a missing-but-optional
 * settings part (settings-signals.ts), `SSIG-SECT-parse-error` warns as a
 * chunk-scan summary flag ("chunk scan reported diagnostics") rather than a
 * specific failure (signal-builder.ts), and `SSIG-USAGE-body-parse-error`/
 * `SSIG-USAGE-numbering-parse-error` are warn-only in every producer site --
 * no vetted warn case among the 5 codes represents a real parse failure, so
 * unlike the unzip translator's `main-document-fallback` there is nothing to
 * allow-list here.
 *
 * @param {{code?: string, severity?: string, message?: string}} record
 * @param {DiagnosticTranslationContext} [ctx]
 * @returns {SuperDocExceptionDiagnosticPayload | null}
 */
export function translateSsigParseDiagnostic(record, ctx = {}) {
  if (!record || typeof record.code !== 'string') return null;
  const { code, severity, message } = record;
  if (!SSIG_PARSE_ERROR_CODES.has(code)) return null;
  if (severity !== 'error') return null;

  return {
    error: new Error(message || code),
    diagnosticCode: 'PARSE_ERROR',
    diagnosticStage: 'parse',
    severity,
    internalCode: code,
    documentId: ctx.documentId ?? null,
    editor: ctx.editor ?? null,
    message: message || code,
  };
}

/**
 * Translates a DOCX export failure (a plain caught `Error`/`unknown` -- no
 * internal taxonomy exists at this layer to duck-type on) into a public
 * diagnostic payload. Always returns a payload; export failures always
 * classify as `RENDER_ERROR`/`'export'` -- a serialization failure of an
 * already-open document, not a document-corruption or capacity issue.
 *
 * @param {unknown} error
 * @param {DiagnosticTranslationContext} [ctx]
 * @returns {SuperDocExceptionDiagnosticPayload}
 */
export function translateExportDiagnostic(error, ctx = {}) {
  const internalCode =
    (error && typeof error === 'object' && typeof error.name === 'string' && error.name) || 'export-failed';
  const message =
    (error && typeof error === 'object' && typeof error.message === 'string' && error.message) || 'DOCX export failed';
  return {
    error,
    diagnosticCode: 'RENDER_ERROR',
    diagnosticStage: 'export',
    severity: 'error',
    internalCode,
    documentId: ctx.documentId ?? null,
    editor: ctx.editor ?? null,
    message,
  };
}
