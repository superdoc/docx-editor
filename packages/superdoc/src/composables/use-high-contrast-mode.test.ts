import { afterEach, describe, it, expect, vi } from 'vite-plus/test';
import * as Vue from 'vue';
import { createApp, defineComponent, h, isReadonly } from 'vue';
import {
  createHighContrastMode,
  HIGH_CONTRAST_MODE_KEY,
  useHighContrastMode,
  type HighContrastMode,
} from './use-high-contrast-mode.js';

const runtimeKey = '__SUPERDOC_V2_BROWSER_RUNTIME__';
const runtimeGlobal = globalThis as typeof globalThis & Record<string, unknown>;
const priorRuntime = runtimeGlobal[runtimeKey];
afterEach(() => {
  vi.doUnmock('vue');
  vi.resetModules();
  if (priorRuntime === undefined) delete runtimeGlobal[runtimeKey];
  else runtimeGlobal[runtimeKey] = priorRuntime;
});

function readFromApp(provided: HighContrastMode | null): HighContrastMode {
  let read: HighContrastMode | undefined;
  const app = createApp(
    defineComponent({
      setup: () => {
        read = useHighContrastMode();
        return () => h('div');
      },
    }),
  );
  if (provided) app.provide(HIGH_CONTRAST_MODE_KEY, provided);
  app.mount(document.createElement('div'));
  app.unmount();
  return read!;
}

describe('high contrast mode', () => {
  it('starts off and follows setHighContrastMode', () => {
    const mode = createHighContrastMode();
    expect(mode.isHighContrastMode.value).toBe(false);
    mode.setHighContrastMode(true);
    expect(mode.isHighContrastMode.value).toBe(true);
  });

  it('gives each instance its own state', () => {
    const first = createHighContrastMode();
    const second = createHighContrastMode();
    first.setHighContrastMode(true);
    expect(second.isHighContrastMode.value).toBe(false);
  });

  it('reads the state provided to its app', () => {
    const provided = createHighContrastMode();
    const read = readFromApp(provided);
    provided.setHighContrastMode(true);
    expect(read.isHighContrastMode.value).toBe(true);
  });

  it('reads high contrast as off when nothing is provided', () => {
    const read = readFromApp(null);
    expect(isReadonly(read.isHighContrastMode)).toBe(true);
    read.setHighContrastMode(true);
    expect(read.isHighContrastMode.value).toBe(false);
  });

  it('keeps missing-provider fallback refs readonly and off', () => {
    const first = readFromApp(null);
    const second = readFromApp(null);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      Reflect.set(first.isHighContrastMode, 'value', true);
      first.setHighContrastMode(true);
      expect(first.isHighContrastMode.value).toBe(false);
      expect(second.isHighContrastMode.value).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it('imports the facade consumer before Vue installation and uses the installed app context', async () => {
    delete runtimeGlobal[runtimeKey];
    vi.resetModules();
    vi.doMock('vue', () => import('../core/v2-integration/internal-vue-runtime.js'));
    const consumer = await import('./use-high-contrast-mode.js');
    expect(runtimeGlobal[runtimeKey]).toBeUndefined();
    expect(() => consumer.createHighContrastMode()).toThrow(/initialize SuperDoc/);
    expect(() => consumer.useHighContrastMode()).toThrow(/initialize SuperDoc/);
    runtimeGlobal[runtimeKey] = { vue: Vue };
    const provided = consumer.createHighContrastMode();
    function readInstalledApp(mode: HighContrastMode | null): HighContrastMode {
      let read: HighContrastMode | undefined;
      const app = Vue.createApp({
        setup() {
          read = consumer.useHighContrastMode();
          return () => Vue.h('div');
        },
      });
      if (mode) app.provide(consumer.HIGH_CONTRAST_MODE_KEY, mode);
      try {
        app.mount(document.createElement('div'));
        return read!;
      } finally {
        app.unmount();
      }
    }
    const read = readInstalledApp(provided);
    expect(read).toBe(provided);
    provided.setHighContrastMode(true);
    expect(read.isHighContrastMode.value).toBe(true);
    const firstOff = readInstalledApp(null);
    const secondOff = readInstalledApp(null);
    expect(Vue.isReadonly(firstOff.isHighContrastMode)).toBe(true);
    firstOff.setHighContrastMode(true);
    expect(firstOff.isHighContrastMode.value).toBe(false);
    expect(secondOff.isHighContrastMode.value).toBe(false);
  });
});
