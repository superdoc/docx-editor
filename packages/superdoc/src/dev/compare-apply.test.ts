import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vite-plus/test';
import {
  applyCompareWithWs09Fallback,
  CompareApplyIneligibleError,
  captureCompareApplyDebugSnapshot,
  compareApplyFallbackMessage,
  settleCompareApplyPaint,
} from './compare-apply';

describe('dev compare apply fallback', () => {
  it('awaits the asynchronous host comparison before checking its summary', () => {
    const testDirectory = dirname(fileURLToPath(import.meta.url));
    const devAppSource = readFileSync(resolve(testDirectory, 'components/SuperdocDev.vue'), 'utf8');

    expect(devAppSource).toContain('const diff = await liveCompareDocApi.diff.compare({ targetSnapshot });');
  });

  it('keeps tracked compare apply when an asynchronous host facade succeeds', async () => {
    const apply = vi.fn(async () => ({ appliedOperations: 3, diagnostics: [] }));
    const outcome = await applyCompareWithWs09Fallback({ diff: { apply } }, { id: 'diff' });

    expect(outcome.changeMode).toBe('tracked');
    expect(outcome.fallbackFromTracked).toBe(false);
    expect(outcome.fallbackReason).toBeNull();
    expect(outcome.applyResult.appliedOperations).toBe(3);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenNthCalledWith(1, { diff: { id: 'diff' } }, { changeMode: 'tracked' });
  });

  it('uses direct mode without attempting a known-blocked tracked apply', async () => {
    const apply = vi.fn(async () => ({ appliedOperations: 2, diagnostics: [] }));
    const diff = {
      applyEligibility: {
        tracked: { status: 'blocked', blockers: [{ message: 'Tracked topology is unsupported.' }] },
        direct: { status: 'candidate', blockers: [] },
      },
    };

    const outcome = await applyCompareWithWs09Fallback({ diff: { apply } }, diff);

    expect(outcome).toMatchObject({ changeMode: 'direct', fallbackFromTracked: true });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ diff }, { changeMode: 'direct' });
  });

  it('does not call apply when both modes have known blockers', async () => {
    const apply = vi.fn();
    const diff = {
      applyEligibility: {
        tracked: { status: 'blocked', blockers: [{ message: 'Tracked apply is blocked.' }] },
        direct: { status: 'blocked', blockers: [{ message: 'Direct apply is blocked.' }] },
      },
    };

    await expect(applyCompareWithWs09Fallback({ diff: { apply } }, diff)).rejects.toBeInstanceOf(
      CompareApplyIneligibleError,
    );
    expect(apply).not.toHaveBeenCalled();
  });

  it('falls back to direct compare apply for relationship-backed tracked deferral', async () => {
    const deferredError = Object.assign(new Error('relationship-backed replay is unavailable in tracked mode'), {
      code: 'CAPABILITY_UNSUPPORTED',
      details: {
        changedFamilies: ['body', 'media', 'package-graph'],
        unsupportedReason: 'family-apply-lane-unavailable',
      },
    });
    const apply = vi
      .fn()
      .mockRejectedValueOnce(deferredError)
      .mockResolvedValueOnce({ appliedOperations: 1, diagnostics: [] });
    const diff = { payload: { relationshipBackedBody: { target: { media: [{ partUri: '/word/media/image.png' }] } } } };

    const outcome = await applyCompareWithWs09Fallback({ diff: { apply } }, diff);

    expect(outcome).toMatchObject({
      changeMode: 'direct',
      fallbackFromTracked: true,
      fallbackReason: 'tracked-deferred',
      applyResult: { appliedOperations: 1 },
    });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenNthCalledWith(1, { diff }, { changeMode: 'tracked' });
    expect(apply).toHaveBeenNthCalledWith(2, { diff }, { changeMode: 'direct' });
  });

  it('does not retry unrelated body deferrals without relationship-backed media', async () => {
    const deferredError = Object.assign(new Error('body replay is unavailable'), {
      code: 'CAPABILITY_UNSUPPORTED',
      details: {
        changedFamilies: ['body'],
        unsupportedReason: 'family-apply-lane-unavailable',
      },
    });
    const apply = vi.fn().mockRejectedValue(deferredError);
    const diff = { payload: { relationshipBackedBody: { target: { media: [] } } } };

    await expect(applyCompareWithWs09Fallback({ diff: { apply } }, diff)).rejects.toBe(deferredError);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('keeps tracked compare apply when a deferred table policy succeeds', async () => {
    const apply = vi.fn(() => ({ appliedOperations: 6, diagnostics: [] }));
    const diff = {
      payload: {
        familyPolicy: [
          { family: 'body', disposition: 'deferred', changed: true, applyRequired: true },
          { family: 'tables', disposition: 'deferred', changed: true, applyRequired: true },
        ],
        mainDocument: {
          target: { xml: '<w:document><w:body><w:tbl/></w:body></w:document>' },
        },
      },
    };

    const outcome = await applyCompareWithWs09Fallback({ diff: { apply } }, diff);

    expect(outcome.changeMode).toBe('tracked');
    expect(outcome.fallbackFromTracked).toBe(false);
    expect(outcome.fallbackReason).toBeNull();
    expect(outcome.applyResult.appliedOperations).toBe(6);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ diff }, { changeMode: 'tracked' });
  });

  it('retries in direct mode for a structured unsafe tracked table row replay', async () => {
    const trackedError = trackedTableRowReplayUnsafeError();
    const diff = tableTopologyDiff();
    const apply = vi.fn().mockRejectedValueOnce(trackedError).mockResolvedValueOnce({ appliedOperations: 5 });

    const outcome = await applyCompareWithWs09Fallback({ diff: { apply } }, diff);

    expect(outcome).toMatchObject({
      changeMode: 'direct',
      fallbackFromTracked: true,
      fallbackReason: 'table-topology',
      applyResult: { appliedOperations: 5 },
    });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenNthCalledWith(1, { diff }, { changeMode: 'tracked' });
    expect(apply).toHaveBeenNthCalledWith(2, { diff }, { changeMode: 'direct' });
  });

  it('rethrows a matching message without structured unsafe table details', async () => {
    const error = Object.assign(new Error('tracked-table-row-replay-unsafe'), {
      code: 'CAPABILITY_UNSUPPORTED',
    });
    const apply = vi.fn().mockRejectedValue(error);

    await expect(applyCompareWithWs09Fallback({ diff: { apply } }, tableTopologyDiff())).rejects.toBe(error);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('rethrows an unsafe tracked table error when target main document XML is missing', async () => {
    const error = trackedTableRowReplayUnsafeError();
    const apply = vi.fn().mockRejectedValue(error);
    const diff = tableTopologyDiff();
    const diffWithoutTargetXml = {
      payload: { ...diff.payload, mainDocument: { target: {} } },
    };

    await expect(applyCompareWithWs09Fallback({ diff: { apply } }, diffWithoutTargetXml)).rejects.toBe(error);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it.each([
    Object.assign(new Error('compare-apply-deferred (ws07)'), { code: 'CAPABILITY_UNSUPPORTED' }),
    Object.assign(new Error('boom'), { code: 'PRECONDITION_FAILED' }),
    Object.assign(new Error('tracked table replay is unsafe'), {
      code: 'CAPABILITY_UNSUPPORTED',
      details: { unsupportedReason: 'tracked-table-row-replay-unsafe', changedFamilies: ['body'] },
    }),
  ])('rethrows unrelated compare apply failures without retrying', async (error) => {
    const apply = vi.fn().mockRejectedValue(error);

    await expect(applyCompareWithWs09Fallback({ diff: { apply } }, tableTopologyDiff())).rejects.toBe(error);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('wraps a failed direct retry with the table topology fallback reason', async () => {
    const trackedError = trackedTableRowReplayUnsafeError();
    const directError = new Error('direct apply is unavailable');
    const apply = vi.fn().mockRejectedValueOnce(trackedError).mockRejectedValueOnce(directError);

    await expect(applyCompareWithWs09Fallback({ diff: { apply } }, tableTopologyDiff())).rejects.toMatchObject({
      cause: directError,
      changeMode: 'direct',
      fallbackReason: 'table-topology',
      message: 'Direct compare apply failed after tracked table row replay was unsafe: direct apply is unavailable',
    });
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('describes successful fallback from its diff context', () => {
    const tableOutcome = {
      applyResult: { appliedOperations: 1 },
      changeMode: 'direct' as const,
      fallbackFromTracked: true,
      fallbackReason: 'table-topology' as const,
    };

    expect(compareApplyFallbackMessage(tableOutcome)).toBe(
      'Tracked compare apply could not safely replay the table topology, so SuperDoc Dev applied the diff in direct mode. ',
    );
  });

  it('awaits mutation readiness paint when the active editor exposes it', async () => {
    const whenPainted = vi.fn(async () => undefined);

    await settleCompareApplyPaint({
      diff: { apply: vi.fn() },
      documentMutationReadiness: { whenPainted },
    });

    expect(whenPainted).toHaveBeenCalledTimes(1);
    expect(whenPainted).toHaveBeenCalledWith();
  });

  it('noops when mutation readiness is unavailable', async () => {
    await expect(settleCompareApplyPaint({ diff: { apply: vi.fn() } })).resolves.toBeUndefined();
  });

  it('captures debug snapshot from doc text, mounted projection, and render readiness', () => {
    const hostDoc = { getText: vi.fn(() => 'alpha beta') };
    const snapshot = captureCompareApplyDebugSnapshot({
      diff: {
        apply: vi.fn(),
      },
      doc: hostDoc,
      host: {
        readMountedProjectionBlocks: vi.fn(() => [{ kind: 'paragraph' }, { kind: 'table' }, { kind: 'table' }]),
        getRenderReadinessSnapshot: vi.fn(() => ({ renderStage: 'render-complete' })),
        getDocumentFacade: vi.fn(() => ({ available: true as const, doc: hostDoc })),
      },
    });

    expect(snapshot).toEqual({
      textLength: 'alpha beta'.length,
      hostFacadeTextLength: 'alpha beta'.length,
      projectionBlockCount: 3,
      projectionTableCount: 2,
      renderStage: 'render-complete',
      hostFacadeMatchesEditorDoc: true,
    });
  });
});

function tableTopologyDiff() {
  return {
    payload: {
      familyPolicy: [
        { family: 'body', disposition: 'deferred', changed: true, applyRequired: true },
        { family: 'tables', disposition: 'deferred', changed: true, applyRequired: true },
      ],
      mainDocument: {
        target: { xml: '<w:document><w:body><w:tbl/></w:body></w:document>' },
      },
    },
  };
}

function trackedTableRowReplayUnsafeError() {
  return Object.assign(new Error('tracked table replay is unsafe'), {
    code: 'CAPABILITY_UNSUPPORTED',
    details: { unsupportedReason: 'tracked-table-row-replay-unsafe', changedFamilies: ['tables'] },
  });
}
