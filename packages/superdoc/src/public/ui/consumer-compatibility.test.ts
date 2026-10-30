/**
 * Compatibility for existing custom-UI consumers.
 *
 * This branch changed who owns the controller: the built-in toolbar, link
 * popover and shortcut routing each used to build their own, and now share the
 * one the instance owns. The ownership tests elsewhere prove the object graph is
 * right. They do not prove the *editing experience* is unchanged, which is the
 * risk that matters to an application already shipping custom UI.
 *
 * Two shapes are covered here, and they are different situations:
 *
 *  - An application that calls `createSuperDocUI()` itself and also renders the
 *    built-in toolbar. That is now two controllers over one host, where it used
 *    to be two controllers over one host as well, so nothing should have moved.
 *    This is the existing-consumer case, and it is the reason this file exists.
 *  - An application reading `superdoc.ui` alongside the built-in toolbar. That
 *    is now one controller with two readers, which is the genuinely new shape.
 *
 * `bullet-list` is the command driven here rather than bold. Bold routes
 * through the Document API and reports `range-selection-required` without a
 * selection surface, so driving it would mean stubbing selection as well and
 * testing the stub. `bullet-list` routes through `editCommands.lists.apply`,
 * which is observable directly, and exercises the same execute-then-recompute
 * path. Bold is still used below, for the failure-reason half: an unsupported
 * reason has to reach both consumers identically too.
 */
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { BuiltInToolbar } from '../../internal/toolbar/built-in-toolbar.js';
import { createSuperDocUI } from './create-super-doc-ui.js';
import type { SuperDocLike, SuperDocUI } from './types.js';
import { createHighContrastMode } from '../../composables/use-high-contrast-mode.js';

/** Controllers built by a test, torn down together. */
const controllers: SuperDocUI[] = [];

interface DrivableHost {
  host: Record<string, unknown>;
  /** Every `lists.apply` input the host received, in order. */
  applied: unknown[];
}

/**
 * A host whose command state actually moves, so "both consumers converge" is a
 * measurable claim rather than two reads of a frozen object.
 */
function makeDrivableHost(): DrivableHost {
  const listeners = new Map<string, Set<() => void>>();
  const applied: unknown[] = [];
  let listSeed: 'bullet' | 'ordered' | null = null;

  const emit = (event: string) => {
    for (const handler of [...(listeners.get(event) ?? [])]) handler();
  };

  const host: Record<string, unknown> = {
    activeEditor: {
      id: 'editor-1',
      editorVersion: 2,
      editCommands: {
        getSnapshot: () => ({
          commands: {
            'lists.apply': { disabled: false, supported: true, value: { seed: listSeed } },
          },
        }),
        lists: {
          apply: (input: unknown) => {
            applied.push(input);
            const kind = (input as { kind?: string } | null)?.kind;
            listSeed = kind === 'bullet' || kind === 'ordered' ? kind : null;
            // A real edit lands and the host announces it; that announcement is
            // what every controller over this host recomputes from.
            emit('document-mode-change');
            return true;
          },
        },
      },
    },
    config: { documentMode: 'editing', rulers: false, layoutEngineOptions: { showFormattingMarks: false } },
    fonts: { getDocumentFontOptions: () => [] },
    on: (event: string, handler: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    },
    off: (event: string, handler: () => void) => listeners.get(event)?.delete(handler),
    emit,
    toggleRuler: vi.fn(),
    toggleFormattingMarks: vi.fn(),
    setShowFormattingMarks: vi.fn(),
  };

  // Mirror `SuperDoc.ui`: one lazily built controller, owned by the host.
  let owned: SuperDocUI | null = null;
  Object.defineProperty(host, 'ui', {
    get() {
      if (!owned) {
        owned = createSuperDocUI({ superdoc: host as SuperDocLike });
        controllers.push(owned);
      }
      return owned;
    },
  });

  return { host, applied };
}

/**
 * Read `BuiltInToolbar`'s own item model for the bullet-list control (`list`),
 * which is a step removed from the controller and is what the Vue layer renders
 * from. It is NOT rendered DOM: nothing is mounted here. Asserting on it shows
 * the toolbar's own view of state tracks the controller; whether that view
 * reaches the screen is covered by the browser suite.
 */
function toolbarListActive(toolbar: BuiltInToolbar): boolean | undefined {
  const item = toolbar.getToolbarItemByName('list') as { active?: { value?: unknown } } | undefined;
  return item ? Boolean(item.active?.value) : undefined;
}

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.destroy();
  document.body.innerHTML = '';
});

describe('an application that builds its own controller beside the built-in toolbar', () => {
  it('propagates a custom-controller action to the toolbar', () => {
    const { host, applied } = makeDrivableHost();
    const toolbar = new BuiltInToolbar({ highContrastMode: createHighContrastMode(), superdoc: host });
    const independent = createSuperDocUI({ superdoc: host as SuperDocLike });
    controllers.push(independent);

    expect(independent.commands.execute('bullet-list')).toBe(true);

    expect(applied).toEqual([{ kind: 'bullet', behavior: 'toggle' }]);
    // The toolbar reads a different controller over the same host; the host's
    // notification is what has to carry the change across.
    expect(host.ui).not.toBe(independent);
    expect((host.ui as SuperDocUI).commands.get('bullet-list').getState().active).toBe(true);

    toolbar.destroy();
  });

  it('propagates a toolbar action to the custom controller', () => {
    const { host, applied } = makeDrivableHost();
    const toolbar = new BuiltInToolbar({ highContrastMode: createHighContrastMode(), superdoc: host });
    const independent = createSuperDocUI({ superdoc: host as SuperDocLike });
    controllers.push(independent);

    expect((host.ui as SuperDocUI).commands.execute('bullet-list')).toBe(true);

    expect(applied).toEqual([{ kind: 'bullet', behavior: 'toggle' }]);
    expect(independent.commands.get('bullet-list').getState().active).toBe(true);

    toolbar.destroy();
  });

  it('leaves the toolbar working after the custom controller is destroyed', () => {
    const { host, applied } = makeDrivableHost();
    const toolbar = new BuiltInToolbar({ highContrastMode: createHighContrastMode(), superdoc: host });
    const independent = createSuperDocUI({ superdoc: host as SuperDocLike });

    independent.destroy();

    // The application tore down its own controller. The instance-owned one, and
    // therefore the toolbar, must be untouched.
    expect((host.ui as SuperDocUI).commands.execute('bullet-list')).toBe(true);
    expect(applied).toEqual([{ kind: 'bullet', behavior: 'toggle' }]);
    expect((host.ui as SuperDocUI).commands.get('bullet-list').getState().active).toBe(true);

    toolbar.destroy();
  });

  it('leaves the custom controller working after the toolbar is destroyed', () => {
    const { host, applied } = makeDrivableHost();
    const toolbar = new BuiltInToolbar({ highContrastMode: createHighContrastMode(), superdoc: host });
    const independent = createSuperDocUI({ superdoc: host as SuperDocLike });
    controllers.push(independent);

    toolbar.destroy();

    // Unmounting the built-in toolbar used to destroy the controller it built.
    // An application panel outliving the toolbar must keep working.
    expect(independent.commands.execute('bullet-list')).toBe(true);
    expect(applied).toEqual([{ kind: 'bullet', behavior: 'toggle' }]);
    expect(independent.commands.get('bullet-list').getState().active).toBe(true);
  });
});

describe('a toolbar that fails to construct', () => {
  it('leaves nothing of itself attached to the shared controller', () => {
    // `SuperDoc.#addToolbar` treats a toolbar failure as non-fatal: it logs and
    // sets `superdoc.toolbar = null`. So a throw part-way through construction
    // produces an object nobody holds and whose `destroy()` can never run. Now
    // that the toolbar binds to the instance's controller rather than its own,
    // whatever it registered before the throw would stay on the canonical
    // controller permanently.
    //
    // A custom button is the visible half: it registers a command. The
    // subscription is the invisible half, and unwinding covers both.
    const { host } = makeDrivableHost();
    const ui = host.ui as SuperDocUI;
    const ghostId = '__builtin_toolbar__ghost';

    expect(ui.commands.get(ghostId).getState().supported).toBe(false);

    // Throw after the custom command is registered: `#bindHostEvents` runs
    // later in the constructor than `#makeToolbarItems`.
    const originalOn = host.on as (event: string, handler: () => void) => void;
    host.on = () => {
      throw new Error('host refused the subscription');
    };

    expect(
      () =>
        new BuiltInToolbar({
          highContrastMode: createHighContrastMode(),
          superdoc: host,
          customButtons: [{ type: 'button', name: 'ghost', tooltip: 'g', icon: '<svg/>', command: () => true }],
        }),
    ).toThrow('host refused the subscription');

    host.on = originalOn;
    expect(ui.commands.get(ghostId).getState().supported).toBe(false);

    // And the controller is still usable by everyone else.
    expect(ui.commands.execute('bullet-list')).toBe(true);
  });
});

describe('an application reading superdoc.ui beside the built-in toolbar', () => {
  it('shows the same command state to the toolbar and to a custom panel', () => {
    const { host } = makeDrivableHost();
    const toolbar = new BuiltInToolbar({ highContrastMode: createHighContrastMode(), superdoc: host });
    const panel = host.ui as SuperDocUI;

    // Driven from the custom panel.
    expect(panel.commands.execute('bullet-list')).toBe(true);
    expect(panel.commands.get('bullet-list').getState().active).toBe(true);
    expect(toolbarListActive(toolbar)).toBe(true);

    toolbar.destroy();
  });

  it('reflects a toolbar-routed change in the custom panel', () => {
    // Driven at the controller boundary rather than through a rendered click.
    // The toolbar routes its own clicks through this same
    // `superdoc.ui.commands` surface, so this is the path a click takes once it
    // leaves the DOM, and it keeps the test off the toolbar's private
    // event plumbing.
    const { host, applied } = makeDrivableHost();
    const toolbar = new BuiltInToolbar({ highContrastMode: createHighContrastMode(), superdoc: host });
    const panel = host.ui as SuperDocUI;

    expect((host.ui as SuperDocUI).commands.execute('bullet-list')).toBe(true);

    expect(applied).toEqual([{ kind: 'bullet', behavior: 'toggle' }]);
    expect(panel.commands.get('bullet-list').getState().active).toBe(true);
    expect(toolbarListActive(toolbar)).toBe(true);

    toolbar.destroy();
  });

  it('keeps a custom panel alive when the built-in toolbar is destroyed', () => {
    // The regression this whole branch is about. Before, the toolbar destroyed
    // the controller it had built; now it shares the instance's. If it ever
    // destroys the shared one again, a panel reading `superdoc.ui` goes dead
    // while still mounted, and every command it offers silently declines.
    //
    // The sibling case in the factory block cannot catch this: there the panel
    // holds its own controller, so the toolbar tearing down `superdoc.ui` is
    // invisible to it. Only a reader of the shared controller notices.
    const { host, applied } = makeDrivableHost();
    const toolbar = new BuiltInToolbar({ highContrastMode: createHighContrastMode(), superdoc: host });
    const panel = host.ui as SuperDocUI;

    toolbar.destroy();

    expect(panel.commands.execute('bullet-list')).toBe(true);
    expect(applied).toEqual([{ kind: 'bullet', behavior: 'toggle' }]);
    expect(panel.commands.get('bullet-list').getState().active).toBe(true);
  });

  it('disables the toolbar control for a command the panel reports unavailable', () => {
    // State coherence is not only about the enabled path. A command the host
    // cannot service has to reach the toolbar as a disabled control, not just
    // as a reason string the panel happens to read.
    //
    // Comparing `panel.commands.get(...)` against `host.ui.commands.get(...)`
    // would prove nothing: `host.ui` is memoized, so both sides are the same
    // object and the assertion cannot fail. The toolbar's own item is the
    // independent reader, so that is what gets queried.
    const { host } = makeDrivableHost();
    const toolbar = new BuiltInToolbar({ highContrastMode: createHighContrastMode(), superdoc: host });
    const panel = host.ui as SuperDocUI;

    const state = panel.commands.get('bold').getState();
    expect(state.supported).toBe(false);
    expect(state.reason).toBe('document-api-unavailable');

    const item = toolbar.getToolbarItemByName('bold') as { disabled?: { value?: unknown } } | undefined;
    expect(item).toBeDefined();
    expect(Boolean(item?.disabled?.value)).toBe(true);

    toolbar.destroy();
  });

  it('keeps the toolbar working when a custom panel unsubscribes and resubscribes', () => {
    const { host } = makeDrivableHost();
    const toolbar = new BuiltInToolbar({ highContrastMode: createHighContrastMode(), superdoc: host });
    const panel = host.ui as SuperDocUI;

    // A panel mounts, observes, and unmounts. Its scope disposal must not take
    // the toolbar's subscriptions with it.
    const scope = panel.createScope();
    const seen: unknown[] = [];
    scope.select((state) => state.documentMode).subscribe((mode) => seen.push(mode));
    scope.dispose();

    expect(panel.commands.execute('bullet-list')).toBe(true);
    expect(toolbarListActive(toolbar)).toBe(true);

    // And it can mount again against the same controller.
    const second = panel.createScope();
    const secondSeen: unknown[] = [];
    second.select((state) => state.documentMode).subscribe((mode) => secondSeen.push(mode));
    expect(panel.commands.get('bullet-list').getState().active).toBe(true);
    second.dispose();

    toolbar.destroy();
  });
});
