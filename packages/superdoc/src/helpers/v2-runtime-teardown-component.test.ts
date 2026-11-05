import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { defineComponent, h, onBeforeUnmount, type ComponentCustomProperties } from 'vue';
import { EventEmitter } from 'eventemitter3';
import { DOCX } from '@superdoc/common';
import { useSuperdocStore, type StoreDocument } from '../stores/superdoc-store.js';
import { normalizeUiConfig } from '../core/config/normalize-ui-config.js';
import SuperDoc from '../SuperDoc.vue';

type HostSnapshot = { state: string; documentMode: string; editableSubset?: { commands: string[] } };
type HostListener = (snapshot: HostSnapshot) => void;
type RegisteredRuntime = {
  id: string;
  dispose(): Promise<void>;
  subscribe(listener: (event: { type: string }) => void): () => void;
  getLegacyEditorProjection(): unknown;
};

const teardown = vi.hoisted(() => ({ child: async () => {} }));

vi.mock('../core/v2-integration/v2-integration.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/v2-integration/v2-integration.js')>();
  return {
    ...actual,
    createDefaultV2Integration: () => ({
      ...actual.createStubV2Integration(),
      EditorComponent: defineComponent({
        name: 'RuntimeTeardownFixture',
        emits: ['v2-editor-ready'],
        setup() {
          onBeforeUnmount(async () => {
            await teardown.child();
          });
          return () => h('div');
        },
      }),
    }),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function teardownFixture() {
  const events: string[] = [];
  const listeners = new Set<HostListener>();
  const runtimes = new Map<string, RegisteredRuntime>();
  let lateSelectionAvailable = false;
  const selection = {
    getSnapshot: () => null,
    subscribe: () => {
      events.push('selection-subscribe');
      return () => {
        events.push('selection-unsubscribe');
      };
    },
  };
  const pinia = createPinia();
  const store = useSuperdocStore(pinia);
  store.documents = [
    { id: 'teardown-doc', type: DOCX, data: new Uint8Array(), editorMountNonce: 0 } as unknown as StoreDocument,
  ];
  const config = {
    documents: [{ id: 'teardown-doc' }],
    modules: { comments: false as const },
    ui: { comments: false as const },
    documentMode: 'editing',
  };
  const superdoc = Object.assign(new EventEmitter(), {
    config,
    uiConfig: normalizeUiConfig(config),
    activeEditor: null as unknown,
    user: { name: 'Fixture author' },
    users: [],
    colors: [],
    setActiveEditor(editor: unknown) {
      this.activeEditor = editor;
    },
    broadcastEditorCreate() {},
    registerEditorRuntime(runtime: RegisteredRuntime) {
      events.push(`register:${runtime.id}`);
      runtimes.set(runtime.id, runtime);
    },
    setActiveRuntime(id: string) {
      this.activeEditor = runtimes.get(id)?.getLegacyEditorProjection() ?? null;
    },
    unregisterEditorRuntime(id: string) {
      events.push(`unregister:${id}`);
      runtimes.delete(id);
    },
  });
  const host = {
    getHandles: () => ({ editing: lateSelectionAvailable ? { selection } : null }),
    enableLateSelection: () => {
      lateSelectionAvailable = true;
    },
    getSnapshot: (): HostSnapshot => ({
      state: 'editing-ready',
      documentMode: 'editing',
      editableSubset: { commands: [] },
    }),
    subscribe(listener: HostListener) {
      events.push('host-subscribe');
      listeners.add(listener);
      return () => {
        events.push('host-unsubscribe');
        listeners.delete(listener);
      };
    },
    getPageMetricsSnapshot: () => ({ pages: [], zoom: { percent: 100 } }),
    publish(snapshot: HostSnapshot) {
      for (const listener of [...listeners]) {
        try {
          listener(snapshot);
        } catch (error) {
          events.push(`listener-error:${(error as Error).message}`);
          console.warn('[typed-host] listener failed', error);
        }
      }
    },
    async dispose() {
      events.push('host-dispose');
      await Promise.resolve();
      events.push('host-publish-disposed');
      host.publish({ state: 'disposed', documentMode: 'editing' });
    },
  };
  teardown.child = async () => {
    events.push('child-before-unmount');
    await host.dispose();
  };
  const wrapper = mount(SuperDoc, {
    global: {
      plugins: [pinia],
      config: { globalProperties: { $superdoc: superdoc } as unknown as ComponentCustomProperties },
      stubs: { SurfaceHost: true, FloatingComments: true, CommentDialog: true },
    },
  });
  await flushPromises();
  wrapper.findComponent({ name: 'RuntimeTeardownFixture' }).vm.$emit('v2-editor-ready', {
    documentId: 'teardown-doc',
    host,
    mount: null,
  });
  await flushPromises();
  expect(runtimes.size).toBe(1);
  expect(listeners.size).toBe(1);
  const runtime = [...runtimes.values()][0]!;
  const runtimeEvents: string[] = [];
  runtime.subscribe((event) => runtimeEvents.push(event.type));
  const globals = wrapper.vm.$.appContext.config.globalProperties as Record<string, unknown>;
  const count = (prefix: string) => events.filter((event) => event.startsWith(prefix)).length;
  const destroyShell = () => {
    wrapper.unmount();
    events.push('owner-global-deleted');
    delete globals.$superdoc;
  };
  return { events, listeners, runtimes, runtimeEvents, host, runtime, wrapper, globals, count, destroyShell };
}

describe('SD-7105 public V2 runtime teardown ownership', () => {
  it('control: an active host disposal unregisters its runtime exactly once', async () => {
    const warn = vi.spyOn(console, 'warn');
    const fixture = await teardownFixture();
    fixture.host.enableLateSelection();
    fixture.host.publish({ state: 'editing-ready', documentMode: 'editing', editableSubset: { commands: [] } });
    expect(fixture.count('selection-subscribe')).toBe(1);
    expect(fixture.runtimeEvents).toContain('state-change');

    await fixture.host.dispose();
    await fixture.host.dispose();
    await fixture.runtime.dispose();
    await fixture.runtime.dispose();

    expect(fixture.runtimes.size).toBe(0);
    expect(fixture.listeners.size).toBe(0);
    expect(fixture.count('register:')).toBe(1);
    expect(fixture.count('unregister:')).toBe(1);
    expect(fixture.count('selection-unsubscribe')).toBe(1);
    expect(fixture.count('listener-error:')).toBe(0);
    expect(fixture.runtimeEvents.filter((type) => type === 'disposed')).toHaveLength(1);
    expect(warn).not.toHaveBeenCalledWith('[typed-host] listener failed', expect.anything());
    fixture.wrapper.unmount();
    await flushPromises();
    expect(fixture.count('unregister:')).toBe(1);
  });

  it('detaches the host subscription before the destroyed shell drops its owner global', async () => {
    const warn = vi.spyOn(console, 'warn');
    const fixture = await teardownFixture();

    fixture.destroyShell();
    expect(fixture.count('unregister:')).toBe(1);
    expect(fixture.listeners.size).toBe(0);

    await flushPromises();
    await fixture.host.dispose();
    await fixture.runtime.dispose();
    await fixture.runtime.dispose();

    expect(fixture.events).toContain('host-publish-disposed');
    expect(fixture.count('register:')).toBe(1);
    expect(fixture.count('unregister:')).toBe(1);
    expect(fixture.count('listener-error:')).toBe(0);
    expect(fixture.runtimes.size).toBe(0);
    expect(fixture.listeners.size).toBe(0);
    expect(warn).not.toHaveBeenCalledWith('[typed-host] listener failed', expect.anything());
  });

  it('does not unregister the runtime a second time when the owner global is retained', async () => {
    const fixture = await teardownFixture();

    fixture.wrapper.unmount();
    await flushPromises();

    expect(fixture.events).toContain('host-publish-disposed');
    expect(fixture.runtimes.size).toBe(0);
    expect(fixture.count('unregister:')).toBe(1);
    expect(fixture.count('listener-error:')).toBe(0);
    expect(fixture.listeners.size).toBe(0);
  });

  it('ignores an already copied host callback after the shell removed the runtime', async () => {
    const warn = vi.spyOn(console, 'warn');
    const fixture = await teardownFixture();
    const copiedListener = [...fixture.listeners][0]!;
    const runtimeEventsBeforeRemoval = fixture.runtimeEvents.length;

    fixture.destroyShell();
    await flushPromises();
    fixture.host.enableLateSelection();
    copiedListener({ state: 'editing-ready', documentMode: 'editing', editableSubset: { commands: [] } });
    copiedListener({ state: 'disposed', documentMode: 'editing' });
    await flushPromises();

    expect(fixture.count('selection-subscribe')).toBe(0);
    expect(fixture.count('unregister:')).toBe(1);
    expect(fixture.runtimeEvents.slice(runtimeEventsBeforeRemoval).filter((type) => type !== 'disposed')).toEqual([]);
    expect(fixture.listeners.size).toBe(0);
    expect(warn).not.toHaveBeenCalledWith('[typed-host] listener failed', expect.anything());
  });
});
