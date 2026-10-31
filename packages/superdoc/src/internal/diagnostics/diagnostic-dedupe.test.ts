import { describe, it, expect } from 'vite-plus/test';
import { getV2DiagnosticGeneration, createV2DiagnosticDedupe, isBootDiagnosticRedundant } from './diagnostic-dedupe.js';

describe('getV2DiagnosticGeneration', () => {
  it('reads a numeric generation off the payload', () => {
    expect(getV2DiagnosticGeneration({ generation: 3 })).toBe(3);
  });

  it('defaults to 0 for a missing or non-numeric generation', () => {
    expect(getV2DiagnosticGeneration({})).toBe(0);
    expect(getV2DiagnosticGeneration(null)).toBe(0);
    expect(getV2DiagnosticGeneration({ generation: 'not-a-number' })).toBe(0);
  });
});

describe('createV2DiagnosticDedupe', () => {
  it('allows the first emission of a given documentId/generation/internalCode', () => {
    const dedupe = createV2DiagnosticDedupe();
    expect(dedupe.shouldEmit('doc-1', 1, 'render.provider-error')).toBe(true);
  });

  it('suppresses a repeated emission with the same internalCode, even if the message/reason text differs', () => {
    // This is the fix for the dedupe fragility finding: real producers embed
    // dynamic detail (lease generation, page indices, underlying error
    // message) in the diagnostic's reason/message text, so dedupe must key
    // on internalCode alone -- not on that text -- or a recurring root cause
    // re-fires onException every time the embedded detail changes.
    const dedupe = createV2DiagnosticDedupe();
    expect(dedupe.shouldEmit('doc-1', 1, 'render.provider-error')).toBe(true);
    expect(dedupe.shouldEmit('doc-1', 1, 'render.provider-error')).toBe(false);
  });

  it('does not suppress a different internalCode in the same generation', () => {
    const dedupe = createV2DiagnosticDedupe();
    expect(dedupe.shouldEmit('doc-1', 1, 'render.provider-error')).toBe(true);
    expect(dedupe.shouldEmit('doc-1', 1, 'render.page-geometry.failed')).toBe(true);
  });

  it('does not suppress the same internalCode in a new generation', () => {
    const dedupe = createV2DiagnosticDedupe();
    expect(dedupe.shouldEmit('doc-1', 1, 'render.provider-error')).toBe(true);
    expect(dedupe.shouldEmit('doc-1', 2, 'render.provider-error')).toBe(true);
  });

  it('resets a scope entirely on generation advance instead of accumulating every generation forever', () => {
    // Memory-bound fix: dedupe only ever looks up the CURRENT generation, so
    // a prior generation's entries can never be matched again once the
    // generation has moved on. Verify this via observable behavior: two
    // distinct codes seen in generation 1 must both be re-emittable once
    // generation 2 starts, proving generation 1's entries were dropped
    // rather than retained alongside generation 2's.
    const dedupe = createV2DiagnosticDedupe();
    expect(dedupe.shouldEmit('doc-1', 1, 'render.provider-error')).toBe(true);
    expect(dedupe.shouldEmit('doc-1', 1, 'render.page-geometry.failed')).toBe(true);
    expect(dedupe.shouldEmit('doc-1', 2, 'render.provider-error')).toBe(true);
    expect(dedupe.shouldEmit('doc-1', 2, 'render.page-geometry.failed')).toBe(true);
    expect(dedupe.shouldEmit('doc-1', 2, 'render.provider-error')).toBe(false);
  });

  it('scopes dedupe independently per documentId', () => {
    const dedupe = createV2DiagnosticDedupe();
    expect(dedupe.shouldEmit('doc-1', 1, 'render.provider-error')).toBe(true);
    expect(dedupe.shouldEmit('doc-2', 1, 'render.provider-error')).toBe(true);
  });

  it('treats a null/undefined documentId as its own stable scope', () => {
    const dedupe = createV2DiagnosticDedupe();
    expect(dedupe.shouldEmit(null, 1, 'render.provider-error')).toBe(true);
    expect(dedupe.shouldEmit(undefined, 1, 'render.provider-error')).toBe(false);
  });
});

describe('isBootDiagnosticRedundant', () => {
  it('is redundant when the diagnostic came from the generic reason branch and specific records exist', () => {
    const bootDiagnostic = { internalCode: 'source-load-failed' };
    expect(isBootDiagnosticRedundant(bootDiagnostic, 'source-load-failed', [{}])).toBe(true);
  });

  it('is not redundant when there are no specific records', () => {
    const bootDiagnostic = { internalCode: 'source-load-failed' };
    expect(isBootDiagnosticRedundant(bootDiagnostic, 'source-load-failed', [])).toBe(false);
  });

  it('is not redundant when the diagnostic came from bootErrorName classification', () => {
    // internalCode is the bootErrorName class name here, not the reason
    // string, so it never matches `reason` -- a render-pipeline signal is
    // never redundant with package diagnostics.
    const bootDiagnostic = { internalCode: 'OpenRenderNoProgressError' };
    expect(isBootDiagnosticRedundant(bootDiagnostic, 'open-failed', [{}])).toBe(false);
  });

  it('is not redundant when there is no boot diagnostic at all', () => {
    expect(isBootDiagnosticRedundant(null, 'source-load-failed', [{}])).toBe(false);
  });
});
