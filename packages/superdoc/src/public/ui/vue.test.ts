/**
 * Behavior of the `superdoc/ui/vue` composables: provider requirement, slice
 * reactivity across bind/unbind, and command re-subscription on a reactive id.
 * The `toSliceSource` normalization contract itself is pinned by
 * `react.test.ts` against the shared `slice-source.ts` implementation.
 */
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import type { App, Ref } from 'vue';

import { provideSuperDocUI, useSetSuperDoc, useSuperDocCommand, useSuperDocSlice, useSuperDocUI } from './vue.js';
import type { SuperDocUIBinding, UseSuperDocCommandResult } from './vue.js';
import type { CommandState, SuperDocLike } from './types.js';

const apps: App[] = [];

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  document.body.innerHTML = '';
});

/**
 * Mount a provider root with a child running `useComposable` in its setup,
 * capturing both the binding and the composable's return value.
 */
function mountWithChild<T>(useComposable: () => T): { binding: SuperDocUIBinding; result: T } {
  let binding!: SuperDocUIBinding;
  let result!: T;
  const Child = defineComponent({
    setup() {
      result = useComposable();
      return () => null;
    },
  });
  const app = createApp(
    defineComponent({
      setup() {
        binding = provideSuperDocUI();
        return () => h(Child);
      },
    }),
  );
  const el = document.createElement('div');
  document.body.append(el);
  app.mount(el);
  apps.push(app);
  return { binding, result };
}

/** A structural host with no controller; the provider builds and owns one. */
function hostWithoutUi(): SuperDocLike {
  return { activeEditor: null, config: {}, on: () => {}, off: () => {} } as unknown as SuperDocLike;
}

describe('superdoc/ui/vue composables', () => {
  it('throw when used outside a provider tree', () => {
    const app = createApp(
      defineComponent({
        setup() {
          expect(() => useSuperDocUI()).toThrowError(/provideSuperDocUI/);
          return () => null;
        },
      }),
    );
    const el = document.createElement('div');
    app.mount(el);
    apps.push(app);
  });

  it('useSuperDocSlice holds the initial value until a host is bound, then follows the source', async () => {
    let listener: ((value: number) => void) | null = null;
    let current = 1;
    const source = {
      getSnapshot: () => current,
      observe: (cb: (value: number) => void) => {
        listener = cb;
        cb(current);
        return () => {
          listener = null;
        };
      },
    };

    const { binding, result } = mountWithChild(() => useSuperDocSlice(() => source, 0));

    expect(result.value).toBe(0);

    binding.setSuperDoc(hostWithoutUi());
    await nextTick();
    expect(result.value).toBe(1);

    current = 2;
    (listener as unknown as (value: number) => void)(2);
    expect(result.value).toBe(2);
  });

  it('useSuperDocSlice adapts a raw get/subscribe source with an immediate emit', async () => {
    const listeners = new Set<(value: string) => void>();
    let current = 'a';
    const raw = {
      get: () => current,
      subscribe: (cb: (value: string) => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    };

    const { binding, result } = mountWithChild(() => useSuperDocSlice(() => raw, ''));

    binding.setSuperDoc(hostWithoutUi());
    await nextTick();
    expect(result.value).toBe('a');

    current = 'b';
    for (const cb of listeners) cb('b');
    expect(result.value).toBe('b');
  });

  it('useSuperDocSlice seeds from the snapshot when the source only notifies on change', async () => {
    // Command-shaped sources (`CommandHandle.observe`) do not emit on attach;
    // the ref must still leave `initial` immediately after a host is bound.
    const changeOnlySource = {
      getSnapshot: () => 7,
      observe: () => () => {},
    };

    const { binding, result } = mountWithChild(() => useSuperDocSlice(() => changeOnlySource, 0));

    binding.setSuperDoc(hostWithoutUi());
    await nextTick();

    expect(result.value).toBe(7);
  });

  it('useSuperDocSlice returns to its initial value when the binding is cleared', async () => {
    const source = {
      getSnapshot: () => 7,
      observe: () => () => {},
    };
    const superdoc = hostWithoutUi();
    const { binding, result } = mountWithChild(() => useSuperDocSlice(() => source, 0));

    binding.setSuperDoc(superdoc);
    await nextTick();
    expect(result.value).toBe(7);

    expect(binding.clearSuperDoc(superdoc)).toBe(true);
    await nextTick();
    expect(result.value).toBe(0);
  });

  it('useSuperDocSlice unsubscribes when the consuming scope is disposed', async () => {
    const unsubscribe = vi.fn();
    const source = {
      getSnapshot: () => 0,
      observe: (cb: (value: number) => void) => {
        cb(0);
        return unsubscribe;
      },
    };

    const { binding } = mountWithChild(() => useSuperDocSlice(() => source, -1));
    binding.setSuperDoc(hostWithoutUi());
    await nextTick();

    apps.pop()?.unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('useSuperDocCommand seeds from the current command state on bind and on id change', async () => {
    // `CommandHandle.observe` notifies on change only. A composable that just
    // subscribes leaves an already-enabled command rendering as disabled until
    // some later recompute happens to touch it, so the seed read is the whole
    // contract here.
    const states: Record<string, CommandState> = {
      bold: { enabled: true, active: true, supported: true },
      italic: { enabled: true, active: false, supported: true },
    };
    const hostWithCommands = {
      activeEditor: null,
      config: {},
      on: () => {},
      off: () => {},
      ui: {
        commands: {
          get: (id: string) => ({
            getState: () => states[id],
            observe: () => () => {},
          }),
        },
      },
    } as unknown as SuperDocLike;

    let commandId!: Ref<string>;
    let command!: UseSuperDocCommandResult;
    const { binding } = mountWithChild(() => {
      commandId = ref('bold');
      command = useSuperDocCommand(commandId);
      return command;
    });

    binding.setSuperDoc(hostWithCommands);
    await nextTick();
    expect(command.state.value).toEqual(states.bold);
    expect(command.enabled.value).toBe(true);
    expect(command.active.value).toBe(true);

    commandId.value = 'italic';
    await nextTick();
    expect(command.state.value).toEqual(states.italic);
    expect(command.active.value).toBe(false);
  });

  it('useSuperDocCommand executes the current reactive id and fails closed before binding', async () => {
    const execute = vi.fn(() => true);
    const executeAsync = vi.fn(async () => true);
    const hostWithCommands = {
      activeEditor: null,
      config: {},
      on: () => {},
      off: () => {},
      ui: {
        commands: {
          get: () => ({
            getState: () => ({ enabled: true, active: false, supported: true }),
            observe: () => () => {},
          }),
          execute,
          executeAsync,
        },
      },
    } as unknown as SuperDocLike;

    let commandId!: Ref<string>;
    let command!: UseSuperDocCommandResult;
    const { binding } = mountWithChild(() => {
      commandId = ref('bold');
      command = useSuperDocCommand(commandId);
      return command;
    });
    const payload = { value: 'test' };

    expect(command.execute(payload)).toBe(false);
    await expect(command.executeAsync(payload)).resolves.toBe(false);

    binding.setSuperDoc(hostWithCommands);
    await nextTick();
    commandId.value = 'italic';
    await nextTick();

    expect(command.execute(payload)).toBe(true);
    await expect(command.executeAsync(payload)).resolves.toBe(true);
    expect(execute).toHaveBeenCalledWith('italic', payload);
    expect(executeAsync).toHaveBeenCalledWith('italic', payload);
  });

  it('a setter captured in setup() still binds from a later ready callback', async () => {
    // The pattern the provider JSDoc documents. Calling `useSetSuperDoc()`
    // inside the callback instead injects with no active component instance
    // and throws, which is why the setter has to be captured during `setup()`.
    let bindLater!: () => void;

    const { binding } = mountWithChild(() => {
      const setSuperDoc = useSetSuperDoc();
      bindLater = () => setSuperDoc(hostWithoutUi());
      return null;
    });

    expect(binding.ui.value).toBeNull();

    // Leave setup entirely, the way an async editor ready callback would.
    await Promise.resolve();
    await nextTick();
    expect(() => bindLater()).not.toThrow();
    await nextTick();

    expect(binding.ui.value).not.toBeNull();
  });

  it('a late ready callback from a torn-down editor does not replace a newer binding', async () => {
    // The provider outliving its editors is the supported shape: a replaced
    // editor reports teardown through `clearSuperDoc` while its own ready
    // callback may still be in flight. Binding that dead host afterwards would
    // leave every composable observing a destroyed instance.
    let bindOld!: () => void;

    const { binding, result: oldHost } = mountWithChild(() => {
      const setSuperDoc = useSetSuperDoc();
      const host = hostWithoutUi();
      bindOld = () => setSuperDoc(host);
      return host;
    });

    // Torn down before it ever bound, so the clear reports it changed nothing.
    expect(binding.clearSuperDoc(oldHost)).toBe(false);

    const newHost = hostWithoutUi();
    binding.setSuperDoc(newHost);
    await nextTick();
    const liveUi = binding.ui.value;
    expect(binding.host.value).toBe(newHost);

    // The replaced editor's ready callback finally lands.
    bindOld();
    await nextTick();

    expect(binding.host.value).toBe(newHost);
    expect(binding.ui.value).toBe(liveUi);
  });
});
