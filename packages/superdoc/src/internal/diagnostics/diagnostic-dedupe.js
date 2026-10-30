/**
 * Dedupe/generation helpers for SuperDoc Diagnostics, split out of
 * `SuperDoc.vue` so this logic is unit-testable without mounting the whole
 * component (SuperDoc.vue has no dedicated test file).
 */

/**
 * Resolves the per-attempt generation number the v2 shell stamps on
 * `v2-editor-failed` / `v2-open-diagnostics` / `v2-render-readiness`
 * payloads (bumped at the START of every `boot()` / `replaceFile()` /
 * `collaboration:document-replaced` attempt in `V2SuperEditor.vue`). Must
 * come from the shell, not be inferred from `onV2EditorReady` timing: that
 * event only fires on success, fires AFTER the diagnostics events on the
 * success path, and never fires at all for a failed attempt.
 *
 * @param {{generation?: unknown} | null} [payload]
 * @returns {number}
 */
export function getV2DiagnosticGeneration(payload) {
  return typeof payload?.generation === 'number' ? payload.generation : 0;
}

/**
 * Creates a dedupe tracker for diagnostic emissions, scoped by documentId
 * and generation. The key is `internalCode` only (per active generation) --
 * it deliberately does NOT include the diagnostic's message/reason text,
 * because the real producers embed dynamic detail in it (e.g.
 * `render.provider-error`'s reason includes the underlying caught error's
 * message; `render.exact-content-hydration-failed` included a lease
 * generation and page-index list before it was excluded entirely). Keying
 * on that text would let the same recurring root cause re-fire `onException`
 * every time the embedded detail differs even slightly, defeating the
 * purpose of dedupe. Collapsing to one emission per (documentId, generation,
 * internalCode) treats repeated occurrences of the same code within one
 * open/replace attempt as one customer-facing issue, which is what an
 * integrator actually wants to see once per attempt.
 *
 * Memory: a scope's `Set` is reset whenever its generation advances, rather
 * than accumulating every generation's entries forever. This is safe --
 * dedupe only ever looks up the CURRENT generation, so a prior generation's
 * entries can never be matched again once the generation has moved on --
 * and bounds a single document's footprint to "distinct codes seen in the
 * current attempt" instead of "every code ever seen across every attempt."
 * It does not bound the outer map across many *different* documentIds over
 * a long-lived SuperDoc instance's life (e.g. a document-management app
 * cycling through many files); evicting on document removal would need to
 * hook document-lifecycle wiring, which is out of scope here.
 *
 * @returns {{ shouldEmit: (documentId: string | null | undefined, generation: number, internalCode: string | null | undefined) => boolean }}
 */
export function createV2DiagnosticDedupe() {
  const seenByScope = new Map();
  const generationByScope = new Map();

  return {
    shouldEmit(documentId, generation, internalCode) {
      const scopeKey = documentId ?? '';
      let seen = seenByScope.get(scopeKey);
      if (!seen || generationByScope.get(scopeKey) !== generation) {
        seen = new Set();
        seenByScope.set(scopeKey, seen);
        generationByScope.set(scopeKey, generation);
      }
      const key = internalCode ?? '';
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
  };
}

/**
 * A single boot failure can translate to a generic reason-based diagnostic
 * (`translateBootFailureReason`, e.g. `source-load-failed` -> `PARSE_ERROR`)
 * and 0..N specific per-record diagnostics (`translateUnzipDiagnostic` over
 * the host's `SDDiagnosticRecord[]`). `source-load-failed`/`open-failed` are
 * always exactly a proxy for a package-integrity failure that has its own,
 * more specific record (confirmed by tracing `readiness.readiness ===
 * 'blocked'`), so emitting the generic diagnostic alongside a specific one
 * produces two `PARSE_ERROR` callbacks for one root cause. A
 * `bootErrorName`-classified diagnostic (render-pipeline signal, not
 * package-integrity) is never redundant this way, since it carries genuinely
 * distinct information from the package diagnostics.
 *
 * @param {{internalCode?: string} | null} bootDiagnostic
 * @param {string} reason
 * @param {readonly unknown[]} translatedRecords
 * @returns {boolean}
 */
export function isBootDiagnosticRedundant(bootDiagnostic, reason, translatedRecords) {
  return Boolean(bootDiagnostic) && bootDiagnostic.internalCode === reason && translatedRecords.length > 0;
}
