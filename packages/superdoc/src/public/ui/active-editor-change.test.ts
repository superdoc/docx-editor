/**
 * What the controller must release when the active editor is replaced.
 *
 * Recomputing aggregate state is not sufficient for anything bound to one
 * specific editor. Two subscriptions are per-editor and both fail quietly:
 *
 *  - A `viewport.observe()` geometry binding points at the old DOM host. Its
 *    state half (ready / selection / zoom) keeps firing, so overlays still move
 *    on selection changes and the breakage only shows as scroll and repaint no
 *    longer tracking. That is why this needs a test rather than being noticed.
 *  - An in-flight async search still holds a generation the controller
 *    considers current, so it resolves and publishes the previous document's
 *    matches into the replacement document's slice.
 *
 * These mount a duck-typed host so the swap can be driven directly, which is
 * the same permissiveness `SuperDocEditorLike` exists to allow.
 */
import { describe, expect, it, vi } from 'vite-plus/test';

import { createSuperDocUI } from './create-super-doc-ui.js';

/** Minimal host event emitter matching what the controller subscribes to. */
function createHostEmitter() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    on(event: string, handler: (...args: unknown[]) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    },
    off(event: string, handler: (...args: unknown[]) => void) {
      handlers.get(event)?.delete(handler);
    },
    emit(event: string) {
      for (const handler of [...(handlers.get(event) ?? [])]) handler();
    },
  };
}

/** A geometry-capable v2 host stub that records attach and detach calls. */
function createGeometryHost() {
  const detach = vi.fn();
  const observeGeometry = vi.fn((cb: () => void) => {
    host.fire = cb;
    return detach;
  });
  const host: { observeGeometry: typeof observeGeometry; detach: typeof detach; fire: (() => void) | null } = {
    observeGeometry,
    detach,
    fire: null,
  };
  return host;
}

describe('active-editor-change releases per-editor viewport bindings', () => {
  it('moves a live geometry observer to the replacement host', () => {
    const first = createGeometryHost();
    const second = createGeometryHost();
    const emitter = createHostEmitter();
    const superdoc = { ...emitter, activeEditor: { editorVersion: 2, host: first } };

    const ui = createSuperDocUI({ superdoc: superdoc as never });
    const stop = ui.viewport.observe(() => {});

    expect(first.observeGeometry).toHaveBeenCalledTimes(1);
    expect(second.observeGeometry).not.toHaveBeenCalled();

    superdoc.activeEditor = { editorVersion: 2, host: second };
    emitter.emit('active-editor-change');

    // The old binding is released and the observer follows the live editor.
    expect(first.detach).toHaveBeenCalledTimes(1);
    expect(second.observeGeometry).toHaveBeenCalledTimes(1);

    stop();
    expect(second.detach).toHaveBeenCalledTimes(1);
  });

  it('does not rebind an observer the consumer already stopped', () => {
    const first = createGeometryHost();
    const second = createGeometryHost();
    const emitter = createHostEmitter();
    const superdoc = { ...emitter, activeEditor: { editorVersion: 2, host: first } };

    const ui = createSuperDocUI({ superdoc: superdoc as never });
    ui.viewport.observe(() => {})();

    superdoc.activeEditor = { editorVersion: 2, host: second };
    emitter.emit('active-editor-change');

    expect(second.observeGeometry).not.toHaveBeenCalled();
  });
  it('does not subscribe to host or document geometry after destroy', () => {
    const host = createGeometryHost();
    const element = document.createElement('div');
    document.body.append(element);
    const superdoc = { ...createHostEmitter(), element, activeEditor: { editorVersion: 2, host } };
    const ui = createSuperDocUI({ superdoc });
    const addListener = vi.spyOn(element.ownerDocument, 'addEventListener');
    try {
      const stop = ui.viewport.observe(vi.fn());
      expect(host.observeGeometry).toHaveBeenCalledTimes(1);
      expect(addListener.mock.calls.some(([type]) => type === 'scroll')).toBe(true);
      stop();
      ui.destroy();

      addListener.mockClear();
      const stopLate = ui.viewport.observe(vi.fn());
      const lateScroll = addListener.mock.calls.some(([type]) => type === 'scroll');
      stopLate();
      expect.soft(host.observeGeometry).toHaveBeenCalledTimes(1);
      expect(lateScroll).toBe(false);
    } finally {
      addListener.mockRestore();
      ui.destroy();
      element.remove();
    }
  });
});

describe('active-editor-change invalidates the search session', () => {
  /** A host whose async query resolution the test controls. */
  function createSearchHost() {
    let settle: ((value: unknown) => void) | null = null;
    const editCommands = {
      search: {
        query: vi.fn(
          () =>
            new Promise((resolve) => {
              settle = resolve;
            }),
        ),
        getState: vi.fn(() => null),
      },
    };
    return { editCommands, resolveQuery: (value: unknown) => settle?.(value) };
  }

  it('drops a pending query so it cannot publish into the new document', async () => {
    const first = createSearchHost();
    const emitter = createHostEmitter();
    const superdoc = { ...emitter, activeEditor: { editorVersion: 2, editCommands: first.editCommands } };

    const ui = createSuperDocUI({ superdoc: superdoc as never });
    ui.search.search('clause');

    const second = createSearchHost();
    superdoc.activeEditor = { editorVersion: 2, editCommands: second.editCommands };
    emitter.emit('active-editor-change');

    // The previous editor's query now resolves with its own matches.
    first.resolveQuery({ total: 7, activeMatchIndex: 0, matches: [{}, {}, {}, {}, {}, {}, {}] });
    await Promise.resolve();
    await Promise.resolve();

    expect(ui.search.getSnapshot().total).toBe(0);
    expect(ui.search.getSnapshot().query).toBe('');
  });

  it('clears the session on the host that painted it, not the replacement', () => {
    // `setSession(..., { highlight: true })` paints into one specific host. By
    // the time this hook runs, `activeEditor` already points at the replacement,
    // so the painting host is unreachable through the usual lookup. Without
    // holding a reference, the old document keeps its highlights and switching
    // back shows a closed slice over a host that still has matches.
    const paint = (name: string) => ({
      setSession: vi.fn(() => ({ total: 2, activeMatchIndex: 0, matches: [{}, {}] })),
      clear: vi.fn(),
      name,
    });
    const firstSearch = paint('first');
    const secondSearch = paint('second');
    const emitter = createHostEmitter();
    const superdoc = {
      ...emitter,
      activeEditor: { editorVersion: 2, host: { search: firstSearch } },
    };

    const ui = createSuperDocUI({ superdoc: superdoc as never });
    ui.search.search('clause');
    expect(firstSearch.setSession).toHaveBeenCalledTimes(1);

    superdoc.activeEditor = { editorVersion: 2, host: { search: secondSearch } };
    emitter.emit('active-editor-change');

    expect(firstSearch.clear).toHaveBeenCalledTimes(1);
    // The replacement never had a session, so it must not be cleared.
    expect(secondSearch.clear).not.toHaveBeenCalled();
    expect(ui.search.getSnapshot().total).toBe(0);
  });

  it('releases a worker-backed fallback session too, not just a host one', () => {
    // A worker-backed editor has no `host.search`, so searches run through
    // `editCommands.search.query`, which paints as well and is released by
    // querying the empty string rather than by `clear()`. Tracking only the host
    // facade left this path's session alive on the previous document.
    const emitter = createHostEmitter();
    const first = createSearchHost();
    const superdoc = { ...emitter, activeEditor: { editorVersion: 2, editCommands: first.editCommands } };

    const ui = createSuperDocUI({ superdoc: superdoc as never });
    ui.search.search('clause');
    expect(first.editCommands.search.query).toHaveBeenCalledTimes(1);

    superdoc.activeEditor = { editorVersion: 2, editCommands: createSearchHost().editCommands };
    emitter.emit('active-editor-change');

    // The previous editor is told to drop its session, addressed by the facade
    // captured when the search opened rather than by whatever is current now.
    expect(first.editCommands.search.query).toHaveBeenCalledTimes(2);
    expect(first.editCommands.search.query).toHaveBeenLastCalledWith({ query: '' });
  });

  /**
   * A host that finds nothing, so the fallback runs too and both paint.
   * `setSession` returning zero matches is what triggers the combined path.
   */
  function createHybridHost() {
    const calls: string[] = [];
    const search = {
      setSession: vi.fn(() => {
        calls.push('host.setSession');
        return { total: 0, activeMatchIndex: -1, matches: [] };
      }),
      clear: vi.fn(() => calls.push('host.clear')),
    };
    const editSearch = {
      query: vi.fn((input: { query?: string } | undefined) => {
        calls.push(`editSearch.query:${JSON.stringify(input?.query)}`);
        return { total: 2, activeMatchIndex: 0, matches: [{}, {}] };
      }),
      getState: vi.fn(() => ({ total: 2, activeMatchIndex: 0, matches: [{}, {}] })),
    };
    return { calls, search, editSearch };
  }

  it('releases both backends when the host found nothing and the fallback painted', () => {
    // The combined path is easy to miss because it needs the host to exist AND
    // come back empty. Then two backends hold a session while the teardown
    // recorded only the host's, so the fallback stayed painted. This one does
    // not even need an editor swap: closing on the same editor leaked it.
    const { calls, search, editSearch } = createHybridHost();
    const emitter = createHostEmitter();
    const superdoc = {
      ...emitter,
      activeEditor: { editorVersion: 2, host: { search }, editCommands: { search: editSearch } },
    };

    const ui = createSuperDocUI({ superdoc: superdoc as never });
    ui.search.search('clause');
    expect(calls).toEqual(['host.setSession', 'editSearch.query:"clause"']);

    calls.length = 0;
    ui.search.close();

    // Both released, and the host exactly once rather than twice.
    expect(calls).toEqual(['host.clear', 'editSearch.query:""']);
  });

  it('releases both backends when the active editor changes', () => {
    const { calls, search, editSearch } = createHybridHost();
    const emitter = createHostEmitter();
    const superdoc = {
      ...emitter,
      activeEditor: { editorVersion: 2, host: { search }, editCommands: { search: editSearch } },
    };

    const ui = createSuperDocUI({ superdoc: superdoc as never });
    ui.search.search('clause');
    calls.length = 0;

    const next = createHybridHost();
    superdoc.activeEditor = {
      editorVersion: 2,
      host: { search: next.search },
      editCommands: { search: next.editSearch },
    };
    emitter.emit('active-editor-change');

    expect(calls).toEqual(['host.clear', 'editSearch.query:""']);
    // The replacement never had a session and must not be told to drop one.
    expect(next.search.clear).not.toHaveBeenCalled();
    expect(next.editSearch.query).not.toHaveBeenCalled();
    expect(ui.search.getSnapshot().total).toBe(0);
  });

  it('clears the slice and notifies observers on the swap', () => {
    const first = createSearchHost();
    const emitter = createHostEmitter();
    const superdoc = { ...emitter, activeEditor: { editorVersion: 2, editCommands: first.editCommands } };

    const ui = createSuperDocUI({ superdoc: superdoc as never });
    ui.search.search('clause');
    expect(ui.search.getSnapshot().query).toBe('clause');

    const seen: string[] = [];
    ui.search.observe((slice) => seen.push(slice.query));
    seen.length = 0;

    superdoc.activeEditor = { editorVersion: 2, editCommands: createSearchHost().editCommands };
    emitter.emit('active-editor-change');

    // Observers are told, rather than left holding the old document's session.
    expect(seen).toContain('');
    expect(ui.search.getSnapshot().open).toBe(false);
  });
});
