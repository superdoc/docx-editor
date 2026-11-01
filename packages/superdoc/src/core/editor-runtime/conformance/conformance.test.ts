// Public runtime conformance tests.
//
// Proves the fake v2 runtime satisfies the contract and that the load-bearing
// discipline holds: async mutation results, synchronous read snapshots, named
// rejection codes, opaque-token round-trip, staleness, and wrong-runtime
// rejection.

import { describe, expect, it } from 'vite-plus/test';
import type { EditorRuntimeCommand, EditorRuntimeCommandKind, EditorRuntimeEvent } from '../index.js';
import { createFakeV2Runtime } from './fake-v2-runtime.js';

const commandFixtureByKind = {
  'text.insert': { kind: 'text.insert', text: 'x' },
  'text.replace': { kind: 'text.replace', text: 'x' },
  'text.deleteBackward': { kind: 'text.deleteBackward' },
  'text.deleteForward': { kind: 'text.deleteForward' },
  'text.paste': { kind: 'text.paste', text: 'x' },
  'history.undo': { kind: 'history.undo' },
  'history.redo': { kind: 'history.redo' },
  'structural.splitBlock': { kind: 'structural.splitBlock' },
  'structural.indent': { kind: 'structural.indent' },
  'structural.outdent': { kind: 'structural.outdent' },
  'formatting.applyMark': { kind: 'formatting.applyMark', mark: 'bold', value: true },
  'formatting.applyParagraph': { kind: 'formatting.applyParagraph', properties: { align: 'center' } },
  'comments.create': { kind: 'comments.create', text: 'hi' },
  'comments.resolve': { kind: 'comments.resolve', commentId: 'c1' },
  'comments.reopen': { kind: 'comments.reopen', commentId: 'c1' },
  'comments.delete': { kind: 'comments.delete', commentId: 'c1' },
  'comments.reply': { kind: 'comments.reply', parentCommentId: 'c1', text: 'hi' },
  'comments.edit': { kind: 'comments.edit', commentId: 'c1', text: 'updated' },
  'trackedChanges.accept': { kind: 'trackedChanges.accept', id: 'tc1' },
  'trackedChanges.reject': { kind: 'trackedChanges.reject', id: 'tc1' },
  'trackedChanges.acceptAll': { kind: 'trackedChanges.acceptAll' },
  'trackedChanges.rejectAll': { kind: 'trackedChanges.rejectAll' },
  'trackedChanges.setAuthoringMode': { kind: 'trackedChanges.setAuthoringMode', mode: 'tracked' },
} satisfies Record<EditorRuntimeCommandKind, EditorRuntimeCommand>;

describe('editor-runtime conformance  -  v2', () => {
  it('exposes stable identity + capabilities', () => {
    const rt = createFakeV2Runtime();
    expect(typeof rt.id).toBe('string');
    expect(rt.kind).toBe('v2');
    const caps = rt.getCapabilities();
    expect(caps.lifecycle).toBeDefined();
    expect(caps.commands).toBeDefined();
    expect(caps.persistence).toBeDefined();
  });

  it('returns a Promise from mutating dispatch (callers always await)', async () => {
    const rt = createFakeV2Runtime();
    const result = rt.dispatch({ kind: 'text.insert', text: 'x' });
    expect(result).toBeInstanceOf(Promise);
    const awaited = await result;
    expect(awaited.status).toBeDefined();
  });

  it('reads selected text + selection snapshot synchronously', () => {
    const rt = createFakeV2Runtime();
    expect(typeof rt.getSelectedText()).toBe('string');
    // Not a thenable  -  synchronous read.
    const snap = rt.getSelectionSnapshot();
    expect(snap === null || typeof snap.isRange === 'boolean').toBe(true);
  });

  it('exposes a synchronous layout snapshot', () => {
    const rt = createFakeV2Runtime();
    const layout = rt.getLayoutSnapshot();
    expect(layout === null || typeof layout.pageCount === 'number').toBe(true);
  });

  it('tracks explicit document-mode transitions without remounting the runtime', async () => {
    const rt = createFakeV2Runtime();

    expect(rt.getSnapshot().documentMode).toBe(rt.getDocumentMode());

    rt.setDocumentMode('viewing');
    expect(rt.getDocumentMode()).toBe('viewing');
    expect(rt.getSnapshot().documentMode).toBe('viewing');
    await expect(rt.dispatch({ kind: 'text.insert', text: 'x' })).resolves.toMatchObject({
      status: 'rejected',
      reason: 'document-readonly',
    });

    rt.setDocumentMode('suggesting');
    expect(rt.getDocumentMode()).toBe('suggesting');
    expect(rt.getSnapshot().documentMode).toBe('suggesting');
    await expect(rt.dispatch({ kind: 'text.insert', text: 'x' })).resolves.toMatchObject({
      status: 'committed',
    });
  });

  it('history.undo with nothing to undo is a named noop, not a rejection', async () => {
    const rt = createFakeV2Runtime();
    const result = await rt.dispatch({ kind: 'history.undo' });
    expect(['history-noop', 'noop']).toContain(result.status);
    if (result.status === 'history-noop' || result.status === 'noop') {
      expect(result.reason).toBe('nothing-to-undo');
    }
  });

  it('rejects a token minted by another runtime with wrong-runtime-token', async () => {
    const a = createFakeV2Runtime({ id: 'runtime-a' });
    const b = createFakeV2Runtime({ id: 'runtime-b' });
    const snapB = b.getSelectionSnapshot();
    expect(snapB?.anchor).toBeDefined();
    const result = await a.dispatch({ kind: 'text.insert', text: 'x', at: snapB!.anchor });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.reason).toBe('wrong-runtime-token');
  });

  it('rejects a stale token after the document revision advances', async () => {
    const rt = createFakeV2Runtime();
    const snap = rt.getSelectionSnapshot();
    expect(snap?.anchor).toBeDefined();
    const token = snap!.anchor!;
    // Advance the document so the token's revision no longer matches.
    await rt.dispatch({ kind: 'text.insert', text: 'mutate' });
    const result = await rt.dispatch({ kind: 'text.replace', text: 'y', range: token });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.reason).toBe('stale-position-token');
  });

  it('opaque tokens are structured-clone safe', () => {
    const rt = createFakeV2Runtime();
    const snap = rt.getSelectionSnapshot();
    expect(snap?.anchor).toBeDefined();
    const cloned = structuredClone(snap!.anchor);
    expect(cloned).toEqual(snap!.anchor);
  });

  it('emits disposed and stops notifying after dispose', async () => {
    const rt = createFakeV2Runtime();
    const events: EditorRuntimeEvent[] = [];
    const unsubscribe = rt.subscribe((e) => events.push(e));
    await rt.dispose();
    expect(events.some((e) => e.type === 'disposed')).toBe(true);
    unsubscribe();
    const afterDispose = await rt.dispatch({ kind: 'text.insert', text: 'x' });
    expect(afterDispose.status).toBe('rejected');
  });

  it('rejects out-of-range zoom with a named target code', async () => {
    const rt = createFakeV2Runtime();
    const result = await rt.setZoom(5000);
    expect(result.status).toBe('rejected');
  });

  it('setZoom updates the synchronous layout snapshot', async () => {
    const rt = createFakeV2Runtime();
    const result = await rt.setZoom(175);
    expect(result).toEqual({ status: 'committed' });
    expect(rt.getLayoutSnapshot()).toMatchObject({ zoom: 175 });
  });
});

describe('editor-runtime conformance  -  v2-specific posture', () => {
  it('advertises every command kind the fake v2 dispatch accepts', async () => {
    const expectedSupportedKinds: readonly EditorRuntimeCommandKind[] = [
      'text.insert',
      'text.replace',
      'text.deleteBackward',
      'text.deleteForward',
      'text.paste',
      'history.undo',
      'history.redo',
      'structural.splitBlock',
      'structural.indent',
      'structural.outdent',
      'formatting.applyMark',
      'formatting.applyParagraph',
      'comments.create',
      'comments.resolve',
      'comments.reopen',
      'comments.delete',
      'comments.reply',
      'comments.edit',
      'trackedChanges.accept',
      'trackedChanges.reject',
      'trackedChanges.acceptAll',
      'trackedChanges.rejectAll',
      'trackedChanges.setAuthoringMode',
    ];
    const rt = createFakeV2Runtime();

    expect(rt.getCapabilities().commands.supportedCommands).toEqual(expectedSupportedKinds);

    for (const kind of expectedSupportedKinds) {
      const result = await rt.dispatch(commandFixtureByKind[kind]);
      if (result.status === 'rejected') {
        expect(result.reason).not.toBe('command-unsupported');
      }
    }
  });

  it('reports find/replace as supported with a sync session snapshot', () => {
    const rt = createFakeV2Runtime();
    const caps = rt.getCapabilities();
    expect(caps.findReplace?.supported).toBe(true);
    expect(caps.findReplace?.hasSyncSessionSnapshot).toBe(true);
    expect(rt.getFindSessionSnapshot?.()).toEqual({
      active: false,
      query: '',
      matchCount: 0,
      activeMatchIndex: -1,
    });
  });

  it('exposes a compatibility projection for activeEditor compatibility', () => {
    const rt = createFakeV2Runtime();
    expect(rt.getLegacyEditorProjection?.()).toBeDefined();
  });

  it('rejects dispatch while the host is saving', async () => {
    const rt = createFakeV2Runtime({ initialState: 'saving' });
    const result = await rt.dispatch({ kind: 'text.insert', text: 'x' });
    expect(result).toEqual({ status: 'rejected', reason: 'host-saving' });
  });

  it('rejects an unknown command with command-unsupported', async () => {
    const rt = createFakeV2Runtime();
    const result = await rt.dispatch({ kind: 'debug.unknown' } as unknown as EditorRuntimeCommand);
    expect(result).toEqual({ status: 'rejected', reason: 'command-unsupported' });
  });
});
