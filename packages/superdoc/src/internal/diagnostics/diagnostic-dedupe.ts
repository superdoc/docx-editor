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
 */
export function getV2DiagnosticGeneration(payload?: { generation?: unknown } | null): number {
  return typeof payload?.generation === 'number' ? payload.generation : 0;
}

export interface V2DiagnosticDedupe {
  markRenderRecovered(documentId: string | null | undefined, generation: number): void;
  shouldEmit(
    documentId: string | null | undefined,
    generation: number,
    internalCode: string | null | undefined,
    presentationCurrent?: boolean,
  ): boolean;
}

export function createV2DiagnosticDedupe(): V2DiagnosticDedupe {
  const seenByScope = new Map<string, Set<string>>();
  const generationByScope = new Map<string, number>();

  return {
    markRenderRecovered(documentId, generation) {
      const scopeKey = documentId ?? '';
      if (generationByScope.get(scopeKey) !== generation) return;
      const seen = seenByScope.get(scopeKey);
      seen?.delete('render.typed.failed');
      seen?.delete('worker-dom.failed');
    },
    shouldEmit(documentId, generation, internalCode, presentationCurrent = false) {
      if (presentationCurrent && (internalCode === 'worker-dom.failed' || internalCode === 'render.typed.failed'))
        return false;
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
 */
export function isBootDiagnosticRedundant(
  bootDiagnostic: { internalCode?: string } | null,
  reason: string,
  translatedRecords: readonly unknown[],
): boolean {
  return bootDiagnostic != null && bootDiagnostic.internalCode === reason && translatedRecords.length > 0;
}
