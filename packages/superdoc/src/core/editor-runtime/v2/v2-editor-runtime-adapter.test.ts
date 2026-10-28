import { describe, expect, it, vi } from 'vite-plus/test';

import { createV2EditorRuntimeAdapter } from './v2-editor-runtime-adapter.js';

function createReadyHost(overrides: Record<string, unknown> = {}) {
  return {
    getSnapshot: () => ({
      state: 'editing-ready',
      documentMode: 'editing',
      editableSubset: {
        editingMounted: true,
        commands: [{ command: 'review.trackedChangeDecide', status: 'supported', rejectionCode: null, detail: null }],
      },
      commentCommandsReason: null,
    }),
    subscribe: () => () => {},
    getDocumentMode: () => 'editing',
    setDocumentMode: vi.fn(),
    setTrackedChangesRenderOptions: vi.fn(),
    setShowFormattingMarks: vi.fn(),
    dispatch: vi.fn(async () => ({ status: 'committed', receipt: { success: true } })),
    save: vi.fn(async () => new ArrayBuffer(0)),
    dispose: vi.fn(async () => {}),
    getHandles: () => ({ editing: null }),
    getPageMetricsSnapshot: () => ({ pages: [], zoom: { percent: 100 } }),
    setZoom: vi.fn(() => ({ status: 'ok' })),
    ...overrides,
  };
}

describe('createV2EditorRuntimeAdapter viewing preferences route', () => {
  it('exports independent policies and rejects legacy conflicts before saving', async () => {
    const host = createReadyHost();
    const { runtime } = createV2EditorRuntimeAdapter({
      id: 'v2-runtime',
      documentId: 'doc-1',
      root: document.createElement('div'),
      host,
    });
    await runtime.exportDocx({
      policies: { trackedChanges: 'original', comments: 'resolve', contentControls: 'flatten' },
    });
    expect(host.save).toHaveBeenLastCalledWith({
      format: 'docx',
      mode: 'original',
      commentExportMode: 'resolve',
      contentControlExportMode: 'flatten',
    });
    await runtime.exportDocx({ isFinalDoc: true });
    expect(host.save).toHaveBeenLastCalledWith({
      format: 'docx',
      mode: 'final',
      commentExportMode: 'preserve',
      contentControlExportMode: 'preserve',
    });
    expect(() => runtime.exportDocx({ isFinalDoc: false, policies: { trackedChanges: 'final' } })).toThrow(/conflict/);
    expect(() => runtime.exportDocx({ commentsType: 'clean', policies: { comments: 'resolve' } })).toThrow(/conflict/);
    expect(host.save).toHaveBeenCalledTimes(2);
  });

  it('routes local formatting marks to the mounted host without document commands', () => {
    const host = createReadyHost();
    const { runtime } = createV2EditorRuntimeAdapter({
      id: 'v2-runtime',
      documentId: 'doc-1',
      root: document.createElement('div'),
      host,
    });
    runtime.setShowFormattingMarks(true);
    runtime.setShowFormattingMarks(false);
    expect(host.setShowFormattingMarks.mock.calls).toEqual([[true], [false]]);
    expect(host.dispatch).not.toHaveBeenCalled();
  });
  it('routes live tracked-change display changes to the mounted v2 host', () => {
    const setTrackedChangesRenderOptions = vi.fn();
    const host = createReadyHost({ setTrackedChangesRenderOptions });
    const { runtime } = createV2EditorRuntimeAdapter({
      id: 'v2-runtime',
      documentId: 'doc-1',
      root: document.createElement('div'),
      host,
    });

    runtime.setTrackedChangesRenderOptions({ mode: 'final', enabled: true });

    expect(setTrackedChangesRenderOptions).toHaveBeenCalledWith({ mode: 'final', enabled: true });
  });
});

describe('createV2EditorRuntimeAdapter review mutation route', () => {
  it('returns the caller-supplied v2 facade as the legacy projection when provided', () => {
    const facade = {
      editorVersion: 2,
      documentId: 'doc-1',
      options: { documentId: 'doc-1' },
      commands: null,
      state: null,
      view: null,
      editCommands: { getMatrix: vi.fn(() => []), getSnapshot: vi.fn(() => ({})) },
    };
    const host = createReadyHost();
    const { runtime } = createV2EditorRuntimeAdapter({
      id: 'v2-runtime',
      documentId: 'doc-1',
      root: document.createElement('div'),
      host,
      getLegacyEditorProjection: () => facade,
    });

    expect(runtime.getLegacyEditorProjection?.()).toBe(facade);
  });

  it('routes tracked-change decisions through the Document API facade', async () => {
    const decide = vi.fn(() => ({ success: true, txId: 'tx-1' }));
    const host = createReadyHost({
      getDocumentFacade: () => ({
        available: true,
        doc: {
          comments: {},
          trackChanges: { decide },
        },
      }),
    });
    const { runtime } = createV2EditorRuntimeAdapter({
      id: 'v2-runtime',
      documentId: 'doc-1',
      root: document.createElement('div'),
      host,
    });

    await expect(runtime.dispatch({ kind: 'trackedChanges.accept', id: 'tc-1' })).resolves.toMatchObject({
      status: 'committed',
    });
    expect(decide).toHaveBeenCalledWith({ decision: 'accept', target: { kind: 'id', id: 'tc-1' } });
    expect(host.dispatch).not.toHaveBeenCalled();
  });

  it('advertises and routes bulk tracked-change decisions when the host publishes bulk support rows', async () => {
    const decide = vi.fn(() => ({ success: true, txId: 'tx-1' }));
    const host = createReadyHost({
      getSnapshot: () => ({
        state: 'editing-ready',
        documentMode: 'editing',
        editableSubset: {
          editingMounted: true,
          commands: [
            { command: 'review.trackedChangeDecide', status: 'supported', rejectionCode: null, detail: null },
            { command: 'trackedChanges.acceptAll', status: 'supported', rejectionCode: null, detail: null },
            { command: 'trackedChanges.rejectAll', status: 'supported', rejectionCode: null, detail: null },
          ],
        },
        commentCommandsReason: null,
      }),
      getDocumentFacade: () => ({
        available: true,
        doc: {
          comments: {},
          trackChanges: { decide },
        },
      }),
    });
    const { runtime } = createV2EditorRuntimeAdapter({
      id: 'v2-runtime',
      documentId: 'doc-1',
      root: document.createElement('div'),
      host,
    });

    expect(runtime.getCapabilities().commands.supportedCommands).toContain('trackedChanges.acceptAll');
    await expect(runtime.dispatch({ kind: 'trackedChanges.acceptAll' })).resolves.toMatchObject({
      status: 'committed',
    });
    expect(decide).toHaveBeenCalledWith({ decision: 'accept', target: { kind: 'all' } });
    expect(host.dispatch).not.toHaveBeenCalled();
  });

  it('does not advertise or dispatch review mutations when the host marks them read-only', async () => {
    const decide = vi.fn(() => ({ success: true, txId: 'tx-1' }));
    const host = createReadyHost({
      getSnapshot: () => ({
        state: 'review-ready',
        documentMode: 'viewing',
        editableSubset: {
          editingMounted: false,
          commands: [
            {
              command: 'review.trackedChangeDecide',
              status: 'unsupported',
              rejectionCode: 'review-surface-read-only',
              detail: 'review-mutations-disabled-in-review-mode',
            },
          ],
        },
        commentCommandsReason: null,
      }),
      getDocumentMode: () => 'viewing',
      getDocumentFacade: () => ({
        available: true,
        doc: {
          comments: {},
          trackChanges: { decide },
        },
      }),
    });
    const { runtime } = createV2EditorRuntimeAdapter({
      id: 'v2-runtime',
      documentId: 'doc-1',
      root: document.createElement('div'),
      host,
    });

    expect(runtime.getSnapshot().state).toBe('review-ready');
    expect(runtime.getCapabilities().trackedChanges.canDecide).toBe(false);
    expect(runtime.getCapabilities().commands.supportedCommands).not.toContain('trackedChanges.accept');
    await expect(runtime.dispatch({ kind: 'trackedChanges.accept', id: 'tc-1' })).resolves.toEqual({
      status: 'rejected',
      reason: 'document-readonly',
      detail: 'review-mutations-disabled-in-review-mode',
    });
    expect(decide).not.toHaveBeenCalled();
    expect(host.dispatch).not.toHaveBeenCalled();
  });

  it('fails review mutations closed when the Document API facade is unavailable', async () => {
    const host = createReadyHost({
      getDocumentFacade: () => ({
        available: false,
        reason: 'document-api-unavailable',
      }),
    });
    const { runtime } = createV2EditorRuntimeAdapter({
      id: 'v2-runtime',
      documentId: 'doc-1',
      root: document.createElement('div'),
      host,
    });

    await expect(runtime.dispatch({ kind: 'trackedChanges.reject', id: 'tc-1' })).resolves.toEqual({
      status: 'rejected',
      reason: 'review-command-unavailable',
    });
    expect(host.dispatch).not.toHaveBeenCalled();
  });
});
