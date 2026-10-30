/**
 * Ownership contract for the `superdoc/ui/vue` provider.
 *
 * The provider binds to the controller the SuperDoc instance already owns
 * (`superdoc.ui`). It must not create one — two controllers would give Vue a
 * divergent copy of command state — and it must not destroy one, because
 * disposing a provider scope would otherwise freeze the built-in toolbar and
 * every other consumer of the same instance.
 *
 * Unlike the React twin (`react-provider-ownership.test.ts`), no framework
 * mock is needed: `vue` is a real dependency of this package, so the provider
 * runs inside genuine mounted apps and `onScopeDispose` fires on unmount.
 */
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { createApp, defineComponent, reactive } from 'vue';
import type { App } from 'vue';

import { createSuperDocUI } from './create-super-doc-ui.js';
import { provideSuperDocUI } from './vue.js';
import type { SuperDocUIBinding } from './vue.js';
import type { SuperDocLike, SuperDocUI } from './types.js';

import { SuperDoc } from '../../core/SuperDoc.js';
import { BuiltInToolbar } from '../../internal/toolbar/built-in-toolbar.js';
import { createHighContrastMode } from '../../composables/use-high-contrast-mode.js';

/** Mounted apps torn down together after each test. */
const apps: App[] = [];

/** Mount a root component that provides the binding, and capture it. */
function mountProvider(): { binding: SuperDocUIBinding; unmount: () => void } {
  let binding!: SuperDocUIBinding;
  const app = createApp(
    defineComponent({
      setup() {
        binding = provideSuperDocUI();
        return () => null;
      },
    }),
  );
  const el = document.createElement('div');
  document.body.append(el);
  app.mount(el);
  apps.push(app);
  return { binding, unmount: () => app.unmount() };
}

/** A structural host that owns one controller, the way `SuperDoc` does. */
function makeHost(): { host: SuperDocLike; controller: SuperDocUI } {
  const host: Record<string, unknown> = {
    activeEditor: null,
    config: {},
    on: () => {},
    off: () => {},
  };
  const controller = createSuperDocUI({ superdoc: host as SuperDocLike });
  host.ui = controller;
  return { host: host as SuperDocLike, controller };
}

const controllers: SuperDocUI[] = [];

function host(): SuperDocLike {
  const made = makeHost();
  controllers.push(made.controller);
  return made.host;
}

/**
 * A structural host with no `ui`. `SuperDocHost` aliases `SuperDocLike`, whose
 * `ui` is optional, so custom adapters and test hosts can legitimately look
 * like this. A real `SuperDoc` never does.
 */
function hostWithoutUi(): SuperDocLike {
  return { activeEditor: null, config: {}, on: () => {}, off: () => {} } as unknown as SuperDocLike;
}

/** Real `SuperDoc` instances created by a test, torn down together. */
const instances: Array<{ destroy: () => void }> = [];

/**
 * A real `SuperDoc`, not a structural stand-in. The ownership tests below use
 * stubs on purpose, to isolate what the provider does. This one exists because
 * a stub cannot show that the provider and the built-in toolbar end up on the
 * same live controller, which is the thing an application actually depends on.
 */
function realSuperDoc() {
  const selector = document.createElement('div');
  document.body.append(selector);
  const superdoc = new SuperDoc({ selector, telemetry: { enabled: false } } as never);
  instances.push(superdoc as unknown as { destroy: () => void });
  return superdoc;
}

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  for (const controller of controllers.splice(0)) controller.destroy();
  for (const instance of instances.splice(0)) instance.destroy();
  document.body.innerHTML = '';
});

describe('provideSuperDocUI — ownership', () => {
  it('publishes the host-owned controller rather than a new one', () => {
    const superdoc = host();
    const { binding } = mountProvider();

    binding.setSuperDoc(superdoc);

    expect(binding.ui.value).toBe(superdoc.ui);
  });

  it('publishes null until a SuperDoc instance is bound', () => {
    const { binding } = mountProvider();

    expect(binding.ui.value).toBeNull();
    expect(binding.host.value).toBeNull();
  });

  it('does not destroy the controller when its scope is disposed', () => {
    const superdoc = host();
    const destroySpy = vi.spyOn(superdoc.ui as SuperDocUI, 'destroy');
    const { binding, unmount } = mountProvider();

    binding.setSuperDoc(superdoc);
    unmount();

    expect(destroySpy).not.toHaveBeenCalled();
  });

  it('does not destroy the previous controller when it rebinds', () => {
    const first = host();
    const second = host();
    const firstDestroy = vi.spyOn(first.ui as SuperDocUI, 'destroy');
    const { binding } = mountProvider();

    binding.setSuperDoc(first);
    binding.setSuperDoc(second);

    expect(firstDestroy).not.toHaveBeenCalled();
    expect(binding.ui.value).toBe(second.ui);
  });

  it('clears only the expected borrowed host without destroying its controller', () => {
    const first = host();
    const second = host();
    const firstDestroy = vi.spyOn(first.ui as SuperDocUI, 'destroy');
    const { binding } = mountProvider();

    binding.setSuperDoc(first);
    expect(binding.clearSuperDoc(second)).toBe(false);
    expect(binding.host.value).toBe(first);

    expect(binding.clearSuperDoc(first)).toBe(true);
    expect(binding.ui.value).toBeNull();
    expect(binding.host.value).toBeNull();
    expect(firstDestroy).not.toHaveBeenCalled();
  });

  it('stops reporting a torn-down editor while the provider stays mounted', () => {
    // Why the unbind exists. A `v-if`'d or replaced editor destroys its
    // instance while the provider above it stays mounted, so neither rebinding
    // nor scope disposal runs. Without an explicit unbind the host ref keeps
    // reporting the dead instance until something else binds, and if the
    // replacement never becomes ready, indefinitely.
    const torn = host();
    const { binding } = mountProvider();
    binding.setSuperDoc(torn);
    expect(binding.host.value).toBe(torn);

    expect(binding.clearSuperDoc(torn)).toBe(true);

    expect(binding.host.value).toBeNull();
    expect(binding.ui.value).toBeNull();
    // Idempotent: a second teardown pass reports it was already unbound.
    expect(binding.clearSuperDoc(torn)).toBe(false);
  });

  it('builds a controller for a structural host that carries none', () => {
    // Regression: binding such a host must not leave every composable unbound.
    const { binding } = mountProvider();

    binding.setSuperDoc(hostWithoutUi());

    expect(binding.ui.value).not.toBeNull();
  });

  it('destroys only the controller it built itself, on scope dispose', () => {
    const { binding, unmount } = mountProvider();
    binding.setSuperDoc(hostWithoutUi());
    const created = binding.ui.value as SuperDocUI;
    const destroySpy = vi.spyOn(created, 'destroy');

    unmount();

    expect(destroySpy).toHaveBeenCalledTimes(1);
  });

  it('ignores a setter call that arrives after the scope is disposed', () => {
    // The documented pattern captures the setter in `setup()` and calls it
    // from the editor's ready callback, so unmounting during a slow document
    // load lands a call here after `onScopeDispose` has run. Building a
    // fallback controller at that point leaks it: the cleanup that would
    // destroy it has already gone.
    const { binding, unmount } = mountProvider();

    unmount();
    binding.setSuperDoc(hostWithoutUi());

    expect(binding.ui.value).toBeNull();
    expect(binding.host.value).toBeNull();
  });

  it('releases a self-built controller when it rebinds to a real instance', () => {
    const { binding } = mountProvider();
    binding.setSuperDoc(hostWithoutUi());
    const created = binding.ui.value as SuperDocUI;
    const destroySpy = vi.spyOn(created, 'destroy');

    const real = host();
    binding.setSuperDoc(real);

    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(binding.ui.value).toBe(real.ui);
  });

  it('releases a self-built controller when the binding is cleared', () => {
    const { binding } = mountProvider();
    const fallbackHost = hostWithoutUi();
    binding.setSuperDoc(fallbackHost);
    const created = binding.ui.value as SuperDocUI;
    const destroySpy = vi.spyOn(created, 'destroy');

    expect(binding.clearSuperDoc(fallbackHost)).toBe(true);

    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(binding.ui.value).toBeNull();
    expect(binding.host.value).toBeNull();
  });
});

describe('provideSuperDocUI — against a real SuperDoc', () => {
  it('unwraps a SuperDoc instance stored in an ordinary reactive ref', () => {
    const superdoc = realSuperDoc();
    const proxied = reactive(superdoc);
    const { binding } = mountProvider();

    expect(() => binding.setSuperDoc(proxied as unknown as SuperDocLike)).not.toThrow();
    expect(binding.host.value).toBe(superdoc);
    expect(binding.ui.value).toBe(superdoc.ui);
  });

  it('publishes the same controller the built-in toolbar reads', () => {
    const superdoc = realSuperDoc();
    const toolbar = new BuiltInToolbar({ highContrastMode: createHighContrastMode(), superdoc: superdoc as never });
    const { binding } = mountProvider();

    binding.setSuperDoc(superdoc as unknown as SuperDocLike);

    // One controller, two consumers. A stub host cannot demonstrate this
    // because it has no toolbar to disagree with.
    expect(binding.ui.value).toBe(superdoc.ui);
    expect((toolbar as unknown as { ui: unknown }).ui).toBe(superdoc.ui);

    toolbar.destroy();
  });

  it('leaves the toolbar working when the provider unmounts and remounts', () => {
    const superdoc = realSuperDoc();
    const toolbar = new BuiltInToolbar({ highContrastMode: createHighContrastMode(), superdoc: superdoc as never });
    const { binding, unmount } = mountProvider();

    binding.setSuperDoc(superdoc as unknown as SuperDocLike);
    unmount();

    // Disposing a Vue tree must not disturb the instance's controller, which
    // the toolbar is still bound to.
    expect((toolbar as unknown as { ui: unknown }).ui).toBe(superdoc.ui);
    expect(() => superdoc.ui.commands.get('bold').getState()).not.toThrow();

    // And a fresh provider can bind again to the same live controller.
    const second = mountProvider();
    second.binding.setSuperDoc(superdoc as unknown as SuperDocLike);
    expect(second.binding.ui.value).toBe(superdoc.ui);

    toolbar.destroy();
  });

  it('stops publishing live state once the instance is destroyed', () => {
    const superdoc = realSuperDoc();
    const { binding } = mountProvider();
    binding.setSuperDoc(superdoc as unknown as SuperDocLike);
    const published = binding.ui.value as SuperDocUI;

    superdoc.destroy();

    // The composables keep their reference; it has to answer rather than
    // throw, and report the document as gone rather than the last one it saw.
    expect(published.document.getSnapshot().ready).toBe(false);
    expect(published.commands.get('bold').getState().enabled).toBe(false);
  });
});
