/**
 * Ownership and lifecycle contract for `superdoc.ui`.
 *
 * SuperDoc owns exactly one UI controller per instance. Everything else — the
 * built-in toolbar, the shell's link popover and keyboard command routing, the
 * React bindings, and application code — is a consumer that must observe the
 * same object and must never destroy it. These tests pin that invariant,
 * because a second controller does not fail loudly: it silently produces a
 * divergent copy of command state, and a consumer-side `destroy()` silently
 * freezes everyone else's.
 *
 * Controller creations are counted by wrapping the factory, so "one controller
 * per instance" is measured rather than assumed.
 *
 * The built-in toolbar is constructed here through the same internal factory
 * `SuperDoc.#addToolbar` uses, rather than by waiting for the async document
 * mount. Ownership is decided at toolbar-construction time, so this exercises
 * the real code path without making an ownership test depend on engine load.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { createBuiltInToolbar } from '../internal/toolbar/index.js';
import type { SuperDocUI } from '../public/ui/types.js';

const factoryCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock('../public/ui/create-super-doc-ui.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../public/ui/create-super-doc-ui.js')>();
  return {
    ...actual,
    createSuperDocUI: (options: Parameters<typeof actual.createSuperDocUI>[0]) => {
      factoryCalls.count += 1;
      return actual.createSuperDocUI(options);
    },
  };
});

const { SuperDoc } = await import('./SuperDoc.js');
type SuperDocInstance = InstanceType<typeof SuperDoc>;
type BuiltInToolbarHandle = ReturnType<typeof createBuiltInToolbar>;

/** Instances created by a test, torn down in `afterEach`. */
const instances: SuperDocInstance[] = [];

/** Mount a SuperDoc. No document is needed to exercise controller ownership. */
function mount(): SuperDocInstance {
  const selector = document.createElement('div');
  document.body.append(selector);
  const superdoc = new SuperDoc({ selector, telemetry: { enabled: false } } as never);
  instances.push(superdoc);
  return superdoc;
}

/** Attach the built-in toolbar the way `SuperDoc.#addToolbar` does. */
function attachToolbar(superdoc: SuperDocInstance): BuiltInToolbarHandle {
  const container = document.createElement('div');
  document.body.append(container);
  const toolbar = createBuiltInToolbar({ superdoc, selector: container });
  superdoc.toolbar = toolbar as never;
  return toolbar;
}

/**
 * Read the internal `superdoc.toolbar.ui` alias. It is deliberately absent
 * from the public toolbar handle type, so the cast is the assertion: the alias
 * exists at runtime and must point at the same controller.
 */
function toolbarController(superdoc: SuperDocInstance): SuperDocUI | undefined {
  return (superdoc.toolbar as unknown as { ui?: SuperDocUI } | null)?.ui;
}

/**
 * Total SuperDoc event listeners. The controller attaches host listeners when
 * it is constructed, so this is how a duplicate controller would show up.
 */
function totalListeners(superdoc: SuperDocInstance): number {
  return superdoc.eventNames().reduce((total, event) => total + superdoc.listenerCount(event), 0);
}

beforeEach(() => {
  factoryCalls.count = 0;
});

afterEach(() => {
  for (const superdoc of instances.splice(0)) superdoc.destroy();
  document.body.innerHTML = '';
});

describe('superdoc.ui — identity', () => {
  it('returns the same controller for every read', () => {
    const superdoc = mount();

    const first = superdoc.ui;

    expect(superdoc.ui).toBe(first);
    expect(superdoc.ui).toBe(first);
    expect(factoryCalls.count).toBe(1);
  });

  it('constructs one controller however many consumers read it', () => {
    const superdoc = mount();

    const first = attachToolbar(superdoc);
    const second = attachToolbar(superdoc);

    expect(first.ui).toBe(superdoc.ui);
    expect(second.ui).toBe(superdoc.ui);
    expect(factoryCalls.count).toBe(1);
  });

  it('keeps the same controller when the active editor is replaced', () => {
    const superdoc = mount();
    const before = superdoc.ui;

    // Stand in for a document/editor swap: the projection changes, the
    // controller reads through to whatever is current and is never rebuilt.
    superdoc.activeEditor = { id: 'replacement' } as never;

    expect(superdoc.ui).toBe(before);
    expect(factoryCalls.count).toBe(1);
  });

  it('tells the controller when the active editor is assigned or cleared', () => {
    // `editorCreate` is emitted after `broadcastReady()`, and nothing emits it
    // at all when the active editor is cleared. Without a signal on both
    // edges the controller keeps publishing the previous editor: a read
    // inside `onReady` would see a disabled command, and a cleared or failed
    // render would report the old document as ready indefinitely.
    const superdoc = mount();
    const seen: string[] = [];
    superdoc.on('active-editor-change', () => seen.push('changed'));

    // `editorVersion: 2` is what marks a v2 facade; without it the projection
    // takes its clear branch and never assigns.
    superdoc.setActiveEditor({ id: 'first', editorVersion: 2 } as never);
    superdoc.setActiveEditor(null);

    expect(seen).toEqual(['changed', 'changed']);
  });

  it('notifies once per transition, not once per clear call', () => {
    // `removeDocument()` reaches the clear primitive twice for one removal:
    // the registry's `active-runtime-unregistered` bridge fires synchronously
    // during `unregister()`, then `removeDocument()` runs its own check
    // against an `activeEditor` it captured beforehand. Two recomputes and
    // two rounds of observer updates for a single transition is wasteful, so
    // the primitive gates on real state change.
    const superdoc = mount();
    superdoc.setActiveEditor({ id: 'only', editorVersion: 2 } as never);

    const clears: string[] = [];
    superdoc.on('active-editor-change', () => clears.push('cleared'));

    superdoc.setActiveEditor(null);
    superdoc.setActiveEditor(null);

    expect(clears).toEqual(['cleared']);
    expect(superdoc.activeEditor).toBeNull();
  });

  it('stays quiet when the same editor is re-activated', () => {
    // `setDocumentMode('editing')` and `setDocumentMode('suggesting')` both
    // re-activate the first document's editor without checking whether it is
    // already active, so an ordinary mode toggle lands here with an unchanged
    // identity. The event is not free to consumers: it releases per-editor work,
    // so a redundant emit throws away a live search session and rebinds every
    // viewport observer. Identity is the discriminator the event name promises.
    const superdoc = mount();
    const editor = { id: 'same', editorVersion: 2 } as never;
    superdoc.setActiveEditor(editor);

    const seen: string[] = [];
    superdoc.on('active-editor-change', () => seen.push('changed'));

    superdoc.setActiveEditor(editor);
    superdoc.setActiveEditor(editor);

    expect(seen).toEqual([]);
    expect(superdoc.activeEditor).toBe(editor);
  });

  it('reports no active document to the controller after a clear', () => {
    // The point of the signal: the snapshot must stop advertising a document
    // that is gone, not merely stop being updated.
    const superdoc = mount();
    superdoc.setActiveEditor({ id: 'only', editorVersion: 2 } as never);
    superdoc.setActiveEditor(null);

    expect(superdoc.ui.document.getSnapshot().ready).toBe(false);
  });

  it('never shares a controller between instances', () => {
    const first = mount();
    const second = mount();
    attachToolbar(first);
    attachToolbar(second);

    expect(first.ui).not.toBe(second.ui);
    expect(toolbarController(first)).toBe(first.ui);
    expect(toolbarController(second)).toBe(second.ui);
    expect(factoryCalls.count).toBe(2);
  });
});

describe('superdoc.ui — usable before the document is ready', () => {
  it('reports pending state instead of throwing', () => {
    const superdoc = mount();

    expect(superdoc.ui.document.getSnapshot().ready).toBe(false);

    // Every slice a custom UI wires up on the first tick must answer safely.
    const sliceStatuses = ['ready', 'pending', 'stale'];
    expect(sliceStatuses).toContain(superdoc.ui.comments.getSnapshot().listStatus);
    expect(sliceStatuses).toContain(superdoc.ui.selection.getSnapshot().status);
    expect(sliceStatuses).toContain(superdoc.ui.trackChanges.getSnapshot().status);

    // A disabled command is a truthful answer; an exception is not.
    expect(superdoc.ui.commands.get('bold').getState().enabled).toBe(false);
  });

  it('accepts observers before readiness and releases them on unsubscribe', () => {
    const superdoc = mount();
    const seen: number[] = [];

    const stop = superdoc.ui.comments.observe((snapshot) => seen.push(snapshot.total));

    expect(seen).toEqual([0]);
    expect(() => stop()).not.toThrow();
  });
});

describe('superdoc.ui — consumers do not own it', () => {
  it('exposes the toolbar handle as an alias of the same controller', () => {
    const superdoc = mount();
    attachToolbar(superdoc);

    expect(toolbarController(superdoc)).toBe(superdoc.ui);
  });

  it('does not multiply host subscriptions as consumers attach', () => {
    const superdoc = mount();

    // `zoomChange` is a controller-only host event: exactly one subscription
    // means exactly one controller, whatever else is attached to the instance.
    void superdoc.ui;
    expect(superdoc.listenerCount('zoomChange')).toBe(1);

    attachToolbar(superdoc);
    attachToolbar(superdoc);

    expect(superdoc.listenerCount('zoomChange')).toBe(1);
  });

  it('survives toolbar destruction', () => {
    const superdoc = mount();
    const toolbar = attachToolbar(superdoc);
    const controller = superdoc.ui;
    const destroySpy = vi.spyOn(controller, 'destroy');

    toolbar.destroy();

    expect(destroySpy).not.toHaveBeenCalled();
    expect(superdoc.ui).toBe(controller);
    expect(superdoc.listenerCount('zoomChange')).toBe(1);
    // Still live: reads answer and observers still attach.
    expect(superdoc.ui.commands.get('bold').getState().enabled).toBe(false);
    superdoc.ui.comments.observe(() => {})();
  });
});

describe('superdoc.ui — destruction', () => {
  it('is destroyed once, by SuperDoc.destroy()', () => {
    const superdoc = mount();
    const destroySpy = vi.spyOn(superdoc.ui, 'destroy');

    superdoc.destroy();

    expect(destroySpy).toHaveBeenCalledTimes(1);
  });

  it('detaches its host subscriptions on destroy', () => {
    const superdoc = mount();
    void superdoc.ui;
    expect(totalListeners(superdoc)).toBeGreaterThan(0);

    superdoc.destroy();

    expect(totalListeners(superdoc)).toBe(0);
  });

  it('tolerates a repeated destroy', () => {
    const superdoc = mount();
    const controller: SuperDocUI = superdoc.ui;

    superdoc.destroy();

    expect(() => superdoc.destroy()).not.toThrow();
    expect(() => controller.destroy()).not.toThrow();
    expect(superdoc.ui).toBe(controller);
  });

  it('keeps reads answering and actions declining after destroy', async () => {
    // "Inert" has to mean more than "no host listeners left". A React tree, a
    // toolbar, or an application panel can outlive `superdoc.destroy()` by a
    // frame and will keep reading and clicking. Every one of those calls must
    // return rather than throw, and every action must decline rather than
    // silently pretend to have run.
    //
    // Scope, stated rather than implied: this covers the reads, command state,
    // execution, and subscription paths listed below. It is not a claim that
    // every method on every handle is disposal-guarded. Format painter is the
    // one place a destroyed controller could call back into application code,
    // so it has its own test; the rest of the domain actions were swept by hand
    // and already fail closed.
    const superdoc = mount();
    const ui: SuperDocUI = superdoc.ui;
    superdoc.destroy();

    // Reads answer.
    expect(ui.document.getSnapshot().ready).toBe(false);
    expect(() => ui.selection.getSnapshot()).not.toThrow();
    expect(() => ui.comments.getSnapshot()).not.toThrow();
    expect(() => ui.toolbar.getSnapshot()).not.toThrow();
    expect(ui.select((state) => state.documentMode).get()).toBe('editing');

    // Commands report themselves unusable rather than throwing or claiming
    // to be enabled.
    const bold = ui.commands.get('bold');
    expect(bold.getState()).toMatchObject({ enabled: false, supported: false, reason: 'not-ready' });

    // Actions decline.
    expect(bold.execute()).toBe(false);
    await expect(bold.executeAsync()).resolves.toBe(false);
    expect(ui.commands.execute('bold')).toBe(false);
    await expect(ui.commands.executeAsync('bold')).resolves.toBe(false);

    // Subscribing is a no-op that still hands back a usable unsubscribe.
    expect(() => ui.comments.observe(() => {})()).not.toThrow();
    expect(() => ui.createScope().dispose()).not.toThrow();
  });

  it('does not call back into application code after destroy', () => {
    // The format painter is the only handle that retains an application callback
    // and later invokes it. Unguarded, `cancel()` fires a listener belonging to
    // a component that may already have unmounted, which is worse than a stale
    // read: it is a torn-down controller re-entering live code.
    const superdoc = mount();
    const ui = superdoc.ui;
    superdoc.destroy();

    let calls = 0;
    const unsubscribe = ui.formatPainter.onModeChange(() => {
      calls += 1;
    });
    ui.formatPainter.cancel();
    ui.formatPainter.setPointerSelecting(true);
    ui.formatPainter.notifyPointerUp();

    expect(calls).toBe(0);
    // The unsubscribe is still a function, so callers need no disposal branch.
    expect(() => unsubscribe()).not.toThrow();
  });

  it('cancels a format-painter capture that is already in flight at destroy', async () => {
    // The disposal guards on the handle only stop captures that have not
    // started. One already awaiting its Document API reads resumes after
    // teardown, and its continuation re-checks the capture epoch before
    // publishing, so teardown has to move that epoch. Otherwise a capture begun
    // a moment before `destroy()` still reaches application callbacks.
    const superdoc = mount();
    const ui = superdoc.ui;
    let calls = 0;
    ui.formatPainter.onModeChange(() => {
      calls += 1;
    });

    const inFlight = ui.commands.executeAsync('copy-format');
    superdoc.destroy();
    await inFlight;
    await Promise.resolve();

    expect(calls).toBe(0);
  });

  it('does not build a live controller for a first read after destroy', () => {
    const superdoc = mount();
    superdoc.destroy();

    const controller = superdoc.ui;

    expect(factoryCalls.count).toBe(1);
    expect(superdoc.ui).toBe(controller);
    // Created inert: nothing was subscribed to the destroyed instance.
    expect(totalListeners(superdoc)).toBe(0);
  });

  it('destroys the controller when destroy() interrupts initialization', () => {
    const superdoc = mount();
    const destroySpy = vi.spyOn(superdoc.ui, 'destroy');

    // No awaiting: the async `#init` is still in flight.
    superdoc.destroy();

    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(totalListeners(superdoc)).toBe(0);
  });
});

/**
 * The shell's link popover, find/replace, and keyboard command routing live in
 * `SuperDoc.vue`, which cannot be mounted without a document. Their ownership
 * is asserted over the source instead, which is also the cheapest place to
 * catch a new consumer quietly constructing or destroying a second controller.
 */
describe('superdoc.ui — sole owner', () => {
  const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

  /** Every non-test source module under `src/`, keyed by its `src/`-relative path. */
  function sourceModules(): Map<string, string> {
    const found = new Map<string, string>();
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (/\.(ts|js|vue)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
          found.set(relative(SRC, path), readFileSync(path, 'utf8'));
        }
      }
    };
    walk(SRC);
    return found;
  }

  it('is the only module that constructs a controller', () => {
    const importers = [...sourceModules()]
      .filter(([, source]) => /from '[^']*create-super-doc-ui\.js'/.test(source))
      .map(([path]) => path)
      .sort();

    // `core/SuperDoc.ts` builds the instance-owned controller. `public/ui.ts`
    // re-exports the factory for advanced npm consumers and never calls it.
    // `public/ui/react.ts` and `public/ui/vue.ts` call it only for a structural
    // host whose optional `ui` is absent, and own what they build. Nothing else
    // may construct one: a controller built elsewhere would diverge from the
    // state the built-in surfaces read.
    expect(importers).toEqual(['core/SuperDoc.ts', 'public/ui.ts', 'public/ui/react.ts', 'public/ui/vue.ts']);
  });

  it('is the only module that destroys a controller', () => {
    const destroyers = [...sourceModules()]
      .filter(([, source]) => /\bui\b.{0,4}\.\s*destroy/s.test(source))
      .map(([path]) => path)
      .sort();

    // `core/SuperDoc.ts` destroys the instance-owned controller.
    // `public/ui/react.ts` destroys only a controller it built itself for a
    // host that carried none; it never destroys `superdoc.ui`.
    expect(destroyers).toEqual(['core/SuperDoc.ts', 'public/ui/react.ts']);
  });

  it('resolves the shell through the instance-owned controller', () => {
    const shell = sourceModules().get('SuperDoc.vue') ?? '';

    expect(shell).toContain('$superdoc?.ui');
  });

  /**
   * The controller-side reset is covered by `document-replaced.test.ts`. These
   * cover the producer: without the emit, the controller listens for a signal
   * that never arrives and every one of those tests still passes.
   */
  describe('replaceFile signals a document replacement', () => {
    it.each([undefined, null, true, 'ok', {}, { state: 'editing-ready' }])(
      'keeps legacy raw results and exposes the same confirmation: %j',
      async (raw) => {
        const superdoc = mount();
        stubLegacyActiveEditor(superdoc, raw);
        const replaced = vi.fn();
        superdoc.on('document-replaced', replaced);
        const source = new Blob(['next']);
        expect(await superdoc.replaceFile(source)).toBe(raw);
        expect(await superdoc.replaceDocument(source)).toEqual({ ok: true });
        expect(replaced).toHaveBeenCalledTimes(2);
      },
    );

    it('preserves a legacy refusal without publishing replacement data or events', async () => {
      const { superdoc, storedData } = mountWithStoredDocument('failed');
      const raw = { state: 'failed', reason: 'open-failed', detail: 'Corrupt zip' };
      Object.defineProperty(superdoc.activeEditor, 'replaceFile', { value: async () => raw });
      const replaced = vi.fn();
      superdoc.on('document-replaced', replaced);
      const source = new Blob(['bad']);

      expect(await superdoc.replaceFile(source)).toBe(raw);
      expect(storedData()).toBe('ORIGINAL');
      expect(replaced).not.toHaveBeenCalled();

      expect(await superdoc.replaceDocument(source)).toEqual({
        ok: false,
        reason: 'open-failed',
        detail: 'Corrupt zip',
      });
      expect(storedData()).toBe('ORIGINAL');
      expect(replaced).not.toHaveBeenCalled();
    });

    it('reports failed replacement even when readiness fires for recovery', async () => {
      const superdoc = mount();
      const raw = { state: 'failed', reason: 'open-failed', detail: 'Invalid document', mount: {} };
      Object.defineProperty(superdoc, 'activeEditor', {
        value: {
          editorVersion: 2,
          replaceFile: async () => {
            superdoc.emit('ready', { superdoc });
            return raw;
          },
        },
        configurable: true,
      });
      const ready = vi.fn();
      const replaced = vi.fn();
      superdoc.on('ready', ready);
      superdoc.on('document-replaced', replaced);
      expect(await superdoc.replaceDocument(new Blob(['bad']))).toEqual({
        ok: false,
        reason: 'open-failed',
        detail: 'Invalid document',
      });
      expect(ready).toHaveBeenCalledOnce();
      expect(replaced).not.toHaveBeenCalled();
      expect(await superdoc.replaceFile(new Blob(['bad']))).toBe(raw);
    });

    it('preserves operational rejections through root and UI methods', async () => {
      const superdoc = mount();
      const error = new Error('Replacement in progress');
      Object.defineProperty(superdoc, 'activeEditor', {
        value: {
          editorVersion: 2,
          replaceFile: async () => {
            throw error;
          },
        },
        configurable: true,
      });
      const source = new Blob(['next']);
      await expect(superdoc.replaceFile(source)).rejects.toBe(error);
      await expect(superdoc.replaceDocument(source)).rejects.toBe(error);
      await expect(superdoc.ui.document.replaceDocument(source)).rejects.toBe(error);
    });

    it.each(['review-ready', 'editing-ready'])('exposes confirmed %s through the UI', async (state) => {
      const superdoc = mount();
      stubActiveEditor(superdoc, state);
      expect(await superdoc.ui.document.replaceDocument(new Blob(['next']))).toEqual({ ok: true });
    });

    it('does not treat a v2 missing state as confirmation', async () => {
      const superdoc = mount();
      stubActiveEditor(superdoc, undefined);
      expect(await superdoc.replaceDocument(new Blob(['next']))).toEqual({ ok: false });
    });

    it.each(['editing-ready', 'failed'])('persists only confirmed replacement bytes: %s', async (state) => {
      const { superdoc, storedData } = mountWithStoredDocument(state);
      const source = new Blob(['next']);
      expect(await superdoc.replaceDocument(source)).toEqual({ ok: state === 'editing-ready' });
      expect(storedData()).toBe(state === 'editing-ready' ? source : 'ORIGINAL');
    });

    /** A v2 editor facade whose replace resolves with the given state. */
    function stubActiveEditor(superdoc: SuperDocInstance, state: unknown): { calls: number } {
      const tracker = { calls: 0 };
      const editor = {
        editorVersion: 2,
        replaceFile: async () => {
          tracker.calls += 1;
          return { state };
        },
      };
      Object.defineProperty(superdoc, 'activeEditor', { value: editor, configurable: true });
      return tracker;
    }

    it('emits after a confirmed replace', async () => {
      const superdoc = mount();
      const tracker = stubActiveEditor(superdoc, 'editing-ready');
      const seen: string[] = [];
      superdoc.on('document-replaced', () => seen.push('replaced'));

      await superdoc.replaceFile(new Blob([new Uint8Array([1, 2, 3])]));

      expect(tracker.calls).toBe(1);
      expect(seen).toEqual(['replaced']);
    });

    /**
     * The whole promise, end to end, through the instance's own controller.
     *
     * The producer tests above cover the emit and the consumer tests in
     * `document-replaced.test.ts` cover the reset, but neither shows the two
     * halves connected: a real `replaceFile()` call reaching a real
     * `superdoc.ui` and resetting the stale slice while leaving the healthy
     * subscription attached. Both outcomes are asserted in one test because it
     * is their combination that is the contract. Resetting search is easy if you
     * are willing to rebind everything, and leaving geometry alone is easy if
     * you reset nothing.
     */
    it('resets search but keeps geometry attached, through superdoc.ui', async () => {
      const superdoc = mount();

      const MATCHES = { total: 4, activeMatchIndex: 0, matches: [{}, {}, {}, {}], canReplace: true };
      const EMPTY = { total: 0, activeMatchIndex: -1, matches: [], canReplace: true };
      let searchState: Record<string, unknown> = EMPTY;
      const detachGeometry = vi.fn();
      const observeGeometry = vi.fn(() => detachGeometry);

      const editor = {
        editorVersion: 2,
        id: 'editor-1',
        editCommands: {
          search: {
            query: (input: { query?: string } | undefined) => {
              searchState = input?.query ? MATCHES : EMPTY;
              return searchState;
            },
            getState: () => searchState,
          },
        },
        host: { observeGeometry },
        replaceFile: async () => {
          // The replacement lands: the content is gone, the objects are not.
          searchState = EMPTY;
          return { state: 'editing-ready' };
        },
      };
      Object.defineProperty(superdoc, 'activeEditor', { value: editor, configurable: true });

      const ui = superdoc.ui;
      ui.viewport.observe(() => {});
      ui.search.search('clause');
      expect(ui.search.getSnapshot().total).toBe(4);
      // Assert the precondition, not just the absence of teardown. A setup
      // regression that stopped binding geometry at all would leave "was not
      // detached" trivially true, and the test would pass while checking nothing.
      expect(observeGeometry).toHaveBeenCalledTimes(1);

      await superdoc.replaceFile(new Blob([new Uint8Array([1, 2, 3])]));

      // 4 described the document that was just replaced.
      expect(ui.search.getSnapshot().total).toBe(0);
      expect(ui.search.getSnapshot().open).toBe(false);
      // The host survived the replace and is rendering the new content, so the
      // subscription pointing at it was neither released nor rebuilt.
      expect(detachGeometry).not.toHaveBeenCalled();
      expect(observeGeometry).toHaveBeenCalledTimes(1);
    });

    /** A legacy (non-v2) editor facade whose replace resolves with `state`. */
    function stubLegacyActiveEditor(superdoc: SuperDocInstance, result: unknown): void {
      const editor = { replaceFile: async () => result };
      Object.defineProperty(superdoc, 'activeEditor', { value: editor, configurable: true });
    }

    it('does not emit when a legacy replace reports a non-ready state', async () => {
      const superdoc = mount();
      stubLegacyActiveEditor(superdoc, { state: 'failed' });
      const seen: unknown[] = [];
      superdoc.on('document-replaced', (payload) => seen.push(payload));

      await superdoc.replaceFile(new Blob([new Uint8Array([1, 2, 3])]));

      // The v2 branch has always gated on state; the legacy branch emitted
      // unconditionally, so an adapter reporting failure without throwing still
      // got a UI reset it had not earned.
      expect(seen).toEqual([]);
    });

    /**
     * Seeds a config document so `#replaceActiveDocumentData()` has something to
     * write to. Without one it early-returns and any assertion about the stored
     * bytes passes trivially — verified: the ungated version writes the Blob, the
     * gated one leaves the original in place.
     */
    function mountWithStoredDocument(state: unknown): { superdoc: SuperDocInstance; storedData: () => unknown } {
      const superdoc = mount() as SuperDocInstance & { config: { documents: Array<Record<string, unknown>> } };
      superdoc.config.documents = [{ id: 'doc-1', type: 'docx', data: 'ORIGINAL' }];
      Object.defineProperty(superdoc, 'activeEditor', {
        value: { options: { documentId: 'doc-1' }, replaceFile: async () => ({ state }) },
        configurable: true,
      });
      return { superdoc, storedData: () => superdoc.config.documents[0]!['data'] };
    }

    it('does not persist bytes for a legacy replace that reports a non-ready state', async () => {
      const { superdoc, storedData } = mountWithStoredDocument('failed');

      await superdoc.replaceFile(new Blob([new Uint8Array([1, 2, 3])]));

      // The v2 branch has always gated the data write and the emit together.
      // Gating only the emit persists an unconfirmed replacement into config and
      // the store, which survives past the failed attempt.
      expect(storedData()).toBe('ORIGINAL');
    });

    it('persists bytes for a legacy replace that reports no state', async () => {
      const { superdoc, storedData } = mountWithStoredDocument(undefined);

      await superdoc.replaceFile(new Blob([new Uint8Array([1, 2, 3])]));

      // Every legacy adapter predating the state field returns nothing, so a
      // missing state has to keep counting as confirmed.
      expect(storedData()).not.toBe('ORIGINAL');
    });

    it('emits for a legacy replace that reports no state at all', async () => {
      const superdoc = mount();
      stubLegacyActiveEditor(superdoc, undefined);
      const seen: unknown[] = [];
      superdoc.on('document-replaced', (payload) => seen.push(payload));

      await superdoc.replaceFile(new Blob([new Uint8Array([1, 2, 3])]));

      // Every legacy adapter predating the state field returns nothing, so a
      // missing state has to keep counting as confirmed.
      expect(seen).toHaveLength(1);
    });

    it('names the editor whose replacement completed', async () => {
      const superdoc = mount();
      stubActiveEditor(superdoc, 'editing-ready');
      const captured = superdoc.activeEditor;
      const seen: Array<{ editor?: unknown }> = [];
      superdoc.on('document-replaced', (payload) => seen.push(payload as { editor?: unknown }));

      await superdoc.replaceFile(new Blob([new Uint8Array([1, 2, 3])]));

      // A consumer needs this to tell "my document was replaced" from "some
      // other document's replace finished while I was looking at this one".
      expect(seen).toHaveLength(1);
      expect(seen[0].editor).toBe(captured);
    });

    it('does not emit when the host rejects the replace', async () => {
      const superdoc = mount();
      stubActiveEditor(superdoc, 'rejected');
      const seen: string[] = [];
      superdoc.on('document-replaced', () => seen.push('replaced'));

      await superdoc.replaceFile(new Blob([new Uint8Array([1, 2, 3])]));

      // Nothing was swapped, so resetting search would discard live state.
      expect(seen).toEqual([]);
    });
  });

  it('signals an active-editor clear from the shared primitive', () => {
    // Runtime unregistration and `removeDocument()` clear the projection
    // directly rather than going through `setActiveEditor(null)`, and
    // `HOST_EVENTS` carries no other signal for those paths. Emitting from
    // the primitive is what makes every clear reach the controller; a
    // caller-level emit would silently miss them.
    const source = sourceModules().get('core/SuperDoc.ts') ?? '';
    const primitive = source.slice(source.indexOf('#clearActiveEditorProjection() {'), source.indexOf('#v2FontsUnsub'));

    expect(primitive).toContain("this.emit('active-editor-change')");
  });
});
