/**
 * `replaceFile()` swaps content under a stable editor identity.
 *
 * The editor object and its host both survive the swap, so the controller sees
 * no `active-editor-change` and nothing resets. Measured before writing the
 * fix: after an in-place replace, `search.total` still reported the previous
 * document's match count, while the geometry subscription was never detached
 * and stayed attached to the host now rendering the replacement.
 *
 * That split is the whole design. A reset broad enough to cover search would
 * also rebind host-scoped subscriptions that were never stale, so the
 * controller keeps two hook lists and `document-replaced` runs only the
 * document-scoped one. These tests pin both halves: the stale slice resets,
 * and the healthy subscription is left alone.
 *
 * Scope is deliberately the replacement LIFECYCLE — the event, its identity, the
 * search reset, the content caches, and what must survive. Hardening found while
 * investigating this (format painter, host caret store, optimistic formatting,
 * review reconciliation) is tracked separately: those are their own defects and
 * should not ride inside a search-lifecycle fix.
 */
import { describe, expect, it, vi } from 'vite-plus/test';

import { createSuperDocUI } from './create-super-doc-ui.js';

const MATCHES = { total: 4, activeMatchIndex: 0, matches: [{}, {}, {}, {}], canReplace: true };
const EMPTY = { total: 0, activeMatchIndex: -1, matches: [], canReplace: true };

/**
 * A host that survives a document swap, as the real one does. `replace()`
 * changes the content without touching the editor or host identity.
 */
function createSwappableHost() {
  let state: Record<string, unknown> = EMPTY;
  const editSearch = {
    query: vi.fn((input: { query?: string } | undefined) => {
      state = input?.query ? MATCHES : EMPTY;
      return state;
    }),
    getState: vi.fn(() => state),
  };

  const detachGeometry = vi.fn();
  const observeGeometry = vi.fn((_callback: () => void): (() => void) | undefined => detachGeometry);

  // An async read so the `contentToken()` cache can be observed. Async slices
  // are keyed by editor identity plus mutation revision, and a replace changes
  // neither, so a cache that is not explicitly invalidated keeps answering for
  // the document that is gone.
  let commentRows = [{ id: 'from-first-document' }];
  const commentsList = vi.fn(async () => ({ items: commentRows }));

  const listeners = new Map<string, Set<(payload?: unknown) => void>>();
  const editor: Record<string, unknown> = {
    id: 'editor-1',
    editorVersion: 2,
    editCommands: { search: editSearch },
    host: { observeGeometry },
    doc: { comments: { list: commentsList } },
  };
  const superdoc: Record<string, unknown> = {
    activeEditor: editor,
    on: (event: string, handler: (payload?: unknown) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    },
    off: (event: string, handler: (payload?: unknown) => void) => listeners.get(event)?.delete(handler),
  };

  return {
    superdoc,
    editor,
    observeGeometry,
    detachGeometry,
    commentsList,
    emit: (event: string, payload?: unknown) => {
      for (const handler of [...(listeners.get(event) ?? [])]) handler(payload);
    },
    /** Content changes; editor and host identity do not. */
    replaceDocument: () => {
      state = EMPTY;
      editSearch.query.mockClear();
      commentRows = [{ id: 'from-second-document' }];
    },
  };
}

describe('document-replaced', () => {
  it('clears search state left over from the replaced document', () => {
    const harness = createSwappableHost();
    const ui = createSuperDocUI({ superdoc: harness.superdoc as never });

    ui.search.search('clause');
    expect(ui.search.getSnapshot().total).toBe(4);

    harness.replaceDocument();
    harness.emit('document-replaced', { editor: harness.editor });

    // 4 belonged to a document that is no longer loaded.
    expect(ui.search.getSnapshot().total).toBe(0);
    expect(ui.search.getSnapshot().open).toBe(false);
    ui.destroy();
  });

  it('leaves host-scoped geometry subscriptions attached', () => {
    const harness = createSwappableHost();
    const ui = createSuperDocUI({ superdoc: harness.superdoc as never });
    ui.viewport.observe(() => {});
    const boundBefore = harness.observeGeometry.mock.calls.length;

    harness.replaceDocument();
    harness.emit('document-replaced', { editor: harness.editor });

    // The host is still the one rendering, so tearing this down and rebinding
    // it would be churn against a subscription that was never stale.
    expect(harness.detachGeometry).not.toHaveBeenCalled();
    expect(harness.observeGeometry.mock.calls.length).toBe(boundBefore);
    ui.destroy();
  });

  it('does not reset search when only the document mode changes', () => {
    const harness = createSwappableHost();
    const ui = createSuperDocUI({ superdoc: harness.superdoc as never });

    ui.search.search('clause');
    expect(ui.search.getSnapshot().total).toBe(4);

    // Switching to viewing must not throw away an open search. This is the
    // regression that a broader "something changed" reset would reintroduce.
    harness.emit('document-mode-change');

    expect(ui.search.getSnapshot().total).toBe(4);
    expect(ui.search.getSnapshot().open).toBe(true);
    ui.destroy();
  });

  it('invalidates the async read caches, not just search', async () => {
    const harness = createSwappableHost();
    const ui = createSuperDocUI({ superdoc: harness.superdoc as never });

    /** Drain the controller's async read scheduling. */
    const settle = async () => {
      for (let i = 0; i < 25; i += 1) {
        ui.comments.getSnapshot();
        await Promise.resolve();
      }
    };

    ui.comments.observe(() => {});
    await settle();
    const before = harness.commentsList.mock.calls.length;
    expect(before).toBeGreaterThan(0);

    harness.replaceDocument();
    harness.emit('document-replaced', { editor: harness.editor });
    await settle();

    // Without the invalidation the cache key is unchanged across a replace and
    // this never rises, so the list keeps describing the replaced document.
    expect(harness.commentsList.mock.calls.length).toBeGreaterThan(before);
    ui.destroy();
  });

  it('stops publishing the replaced document rows, not just re-requesting them', async () => {
    const harness = createSwappableHost();
    const ui = createSuperDocUI({ superdoc: harness.superdoc as never });

    const settle = async () => {
      for (let i = 0; i < 25; i += 1) {
        ui.comments.getSnapshot();
        await Promise.resolve();
      }
    };

    ui.comments.observe(() => {});
    await settle();
    expect(ui.comments.getSnapshot().items.map((item) => item.id)).toEqual(['from-first-document']);

    harness.replaceDocument();
    harness.emit('document-replaced', { editor: harness.editor });

    // Read immediately, before the refresh settles. Advancing the content token
    // alone is not enough: a settled entry is still served as `stale` from any
    // token while its replacement is in flight, so the previous document's rows
    // stay publicly visible. Right after a replace the host is loading, which is
    // exactly when heavy reads are deliberately held, so that window is not brief.
    expect(ui.comments.getSnapshot().items.map((item) => item.id)).not.toContain('from-first-document');

    await settle();
    expect(ui.comments.getSnapshot().items.map((item) => item.id)).toEqual(['from-second-document']);
    ui.destroy();
  });

  it('retries a geometry bind that threw, rather than treating it as live', () => {
    const harness = createSwappableHost();
    let failNext = true;
    harness.observeGeometry.mockImplementation(() => {
      if (failNext) throw new Error('host refused the subscription');
      return harness.detachGeometry;
    });
    const ui = createSuperDocUI({ superdoc: harness.superdoc as never });
    ui.viewport.observe(() => {});
    const attempts = harness.observeGeometry.mock.calls.length;
    expect(attempts).toBeGreaterThan(0);

    // The first bind threw, so nothing is subscribed. Recording the host anyway
    // would make the rebind skip treat this observer as live and never retry it.
    failNext = false;
    harness.superdoc.activeEditor = {
      id: 'editor-1-refreshed',
      editorVersion: 2,
      editCommands: (harness.editor as { editCommands: unknown }).editCommands,
      host: (harness.editor as { host: unknown }).host,
    };
    harness.emit('active-editor-change');

    expect(harness.observeGeometry.mock.calls.length).toBeGreaterThan(attempts);
    ui.destroy();
  });

  it('treats a subscription with no unsubscribe function as live', () => {
    const harness = createSwappableHost();
    // A host may subscribe successfully and return nothing to unsubscribe with.
    // That is still a live binding, so a same-host refresh must not churn it.
    harness.observeGeometry.mockImplementation(() => undefined);
    const ui = createSuperDocUI({ superdoc: harness.superdoc as never });
    ui.viewport.observe(() => {});
    const boundOnce = harness.observeGeometry.mock.calls.length;

    harness.superdoc.activeEditor = {
      id: 'editor-1-refreshed',
      editorVersion: 2,
      editCommands: (harness.editor as { editCommands: unknown }).editCommands,
      host: (harness.editor as { host: unknown }).host,
    };
    harness.emit('active-editor-change');

    expect(harness.observeGeometry.mock.calls.length).toBe(boundOnce);
    ui.destroy();
  });

  it('clears binding state on detach even with no unsubscribe function', () => {
    const harness = createSwappableHost();
    harness.observeGeometry.mockImplementation(() => undefined);
    const ui = createSuperDocUI({ superdoc: harness.superdoc as never });
    ui.viewport.observe(() => {});
    const originalHost = (harness.editor as { host: unknown }).host;
    const boundOnce = harness.observeGeometry.mock.calls.length;

    // Away to a host that EXISTS but exposes no `observeGeometry`. Detach runs
    // with nothing to call, and the bind that follows returns early without
    // recording anything — so if detach did not clear the recorded host, the
    // stale value survives. A transient NULL host would not exercise this,
    // because that case now leaves the binding alone by design.
    harness.superdoc.activeEditor = { id: 'no-geometry', editorVersion: 2, editCommands: {}, host: {} };
    harness.emit('active-editor-change');

    // Back to the ORIGINAL host object. With a stale host recorded, the same-host
    // guard fires and this observer never rebinds.
    harness.superdoc.activeEditor = {
      id: 'editor-1-again',
      editorVersion: 2,
      editCommands: (harness.editor as { editCommands: unknown }).editCommands,
      host: originalHost,
    };
    harness.emit('active-editor-change');

    expect(harness.observeGeometry.mock.calls.length).toBeGreaterThan(boundOnce);
    ui.destroy();
  });

  it('releases geometry once a hostless moment proves permanent', async () => {
    const harness = createSwappableHost();
    // A disposer that genuinely unsubscribes. A stub that only records the call
    // would leave the callback live and make the assertion below measure the
    // mock rather than the controller.
    const callbacks = new Set<() => void>();
    harness.observeGeometry.mockImplementation((cb: () => void) => {
      callbacks.add(cb);
      return () => {
        callbacks.delete(cb);
        harness.detachGeometry();
      };
    });
    const ui = createSuperDocUI({ superdoc: harness.superdoc as never });
    let fired = 0;
    ui.viewport.observe(() => {
      fired += 1;
    });

    // removeDocument() / a fail-closed projection: cleared, and nothing takes its
    // place. Indistinguishable from a refresh at this instant, which is why the
    // release is deferred rather than decided here.
    harness.superdoc.activeEditor = null;
    harness.emit('active-editor-change');
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.detachGeometry).toHaveBeenCalled();

    // Isolate the geometry half. `observe()` also tracks ready/selection/zoom,
    // and clearing the active editor moves `ready`, so the state subscription
    // legitimately fires here — counting it would measure the wrong half.
    await new Promise((resolve) => setTimeout(resolve, 20));
    fired = 0;

    // Measured before the fix: the departed host kept driving the consumer.
    callbacks.forEach((cb) => cb());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fired).toBe(0);
    ui.destroy();
  });

  it('detaches geometry subscriptions on destroy', () => {
    const harness = createSwappableHost();
    const ui = createSuperDocUI({ superdoc: harness.superdoc as never });
    ui.viewport.observe(() => {});
    expect(harness.detachGeometry).not.toHaveBeenCalled();

    // `observe()` returns a disposer, but a consumer that just drops the
    // controller never calls it. Measured before the fix: destroy() with a live
    // host detached nothing and left the subscription on the host.
    ui.destroy();

    expect(harness.detachGeometry).toHaveBeenCalled();
  });

  it('keeps the geometry subscription through the transient null of a V2 refresh', async () => {
    const harness = createSwappableHost();
    const ui = createSuperDocUI({ superdoc: harness.superdoc as never });
    ui.viewport.observe(() => {});
    const boundOnce = harness.observeGeometry.mock.calls.length;
    const survivingHost = (harness.editor as { host: unknown }).host;

    // Production does not go old facade -> new. `registerV2Runtime` unregisters
    // the active runtime first, clearing `activeEditor` synchronously, so the
    // first event arrives with no host at all.
    harness.superdoc.activeEditor = null;
    harness.emit('active-editor-change');
    harness.superdoc.activeEditor = {
      id: 'editor-1-refreshed',
      editorVersion: 2,
      editCommands: (harness.editor as { editCommands: unknown }).editCommands,
      host: survivingHost,
    };
    harness.emit('active-editor-change');

    // Past the deferred release check, which must see the replacement host and
    // leave the subscription alone.
    await Promise.resolve();
    await Promise.resolve();

    // Measured before the fix: detach fired on the null step and observeGeometry
    // ran again on the next, which is exactly the churn the guard exists to stop.
    expect(harness.detachGeometry).not.toHaveBeenCalled();
    expect(harness.observeGeometry.mock.calls.length).toBe(boundOnce);
    ui.destroy();
  });

  it('keeps the geometry subscription across a facade refresh over the same host', () => {
    const harness = createSwappableHost();
    const ui = createSuperDocUI({ superdoc: harness.superdoc as never });
    ui.viewport.observe(() => {});
    const boundOnce = harness.observeGeometry.mock.calls.length;
    expect(boundOnce).toBe(1);

    // The V2 facade refresh fires `active-editor-change` BEFORE
    // `document-replaced` arrives, so an unconditional rebind there tears the
    // subscription off its own host and puts it straight back — defeating the
    // preservation the document/editor hook split exists to provide.
    harness.superdoc.activeEditor = {
      id: 'editor-1-refreshed',
      editorVersion: 2,
      editCommands: (harness.editor as { editCommands: unknown }).editCommands,
      host: (harness.editor as { host: unknown }).host,
    };
    harness.emit('active-editor-change');

    expect(harness.detachGeometry).not.toHaveBeenCalled();
    expect(harness.observeGeometry.mock.calls.length).toBe(boundOnce);
    ui.destroy();
  });

  it('resets across a V2 facade refresh, where the editor object no longer matches', () => {
    const harness = createSwappableHost();
    const ui = createSuperDocUI({ superdoc: harness.superdoc as never });
    const capturedEditor = harness.editor;
    const survivingHost = (harness.editor as { host: unknown }).host;

    ui.search.search('clause');
    expect(ui.search.getSnapshot().total).toBe(4);

    // What the V2 browser path actually does: the ready payload is emitted before
    // replaceFile() resolves, so the shell installs a NEW facade first. The event
    // then names a facade this controller no longer holds, and matching on the
    // editor alone makes the reset a no-op exactly where it matters most.
    harness.superdoc.activeEditor = {
      id: 'editor-1-refreshed',
      editorVersion: 2,
      editCommands: (capturedEditor as { editCommands: unknown }).editCommands,
      host: survivingHost,
    };
    harness.replaceDocument();
    harness.emit('document-replaced', { editor: capturedEditor, host: survivingHost });

    // The host survives the swap, so it is the identity that still lines up.
    expect(ui.search.getSnapshot().total).toBe(0);
    expect(ui.search.getSnapshot().open).toBe(false);
    ui.destroy();
  });

  it('ignores a replacement whose editor and host are both unrelated', () => {
    const harness = createSwappableHost();
    const ui = createSuperDocUI({ superdoc: harness.superdoc as never });

    ui.search.search('clause');
    expect(ui.search.getSnapshot().total).toBe(4);

    // Neither identity matches, so this is somebody else's replacement.
    harness.emit('document-replaced', { editor: { id: 'other' }, host: { id: 'other-host' } });

    expect(ui.search.getSnapshot().total).toBe(4);
    expect(ui.search.getSnapshot().open).toBe(true);
    ui.destroy();
  });

  it('ignores a replacement that completed for a different editor', () => {
    const harness = createSwappableHost();
    const ui = createSuperDocUI({ superdoc: harness.superdoc as never });

    ui.search.search('clause');
    expect(ui.search.getSnapshot().total).toBe(4);

    // A replace started on another document finishes after the user moved on.
    // Acting on it would clear the search they just opened here.
    harness.emit('document-replaced', { editor: { id: 'a-different-editor' } });

    expect(ui.search.getSnapshot().total).toBe(4);
    expect(ui.search.getSnapshot().open).toBe(true);
    ui.destroy();
  });

  it('ignores an event that names no editor at all', () => {
    const harness = createSwappableHost();
    const ui = createSuperDocUI({ superdoc: harness.superdoc as never });

    ui.search.search('clause');
    expect(ui.search.getSnapshot().total).toBe(4);

    // Fail closed. An event that does not identify its editor cannot be
    // confirmed as this controller's, and treating it as such would clear a
    // search on whatever happens to be bound — the same mis-scoping the payload
    // exists to prevent. Every real emit site names the editor.
    harness.emit('document-replaced');
    harness.emit('document-replaced', {});
    harness.emit('document-replaced', { editor: null });

    expect(ui.search.getSnapshot().total).toBe(4);
    expect(ui.search.getSnapshot().open).toBe(true);
    ui.destroy();
  });

  it('still resets both scopes when the active editor changes', () => {
    const harness = createSwappableHost();
    const ui = createSuperDocUI({ superdoc: harness.superdoc as never });
    ui.viewport.observe(() => {});
    ui.search.search('clause');

    harness.superdoc.activeEditor = {
      id: 'editor-2',
      editorVersion: 2,
      editCommands: { search: { query: () => null, getState: () => null } },
      host: { observeGeometry: harness.observeGeometry },
    };
    harness.emit('active-editor-change');

    // A real editor swap invalidates the host too, so unlike a replace this
    // one does release the geometry subscription.
    expect(ui.search.getSnapshot().total).toBe(0);
    expect(harness.detachGeometry).toHaveBeenCalled();
    ui.destroy();
  });
});
