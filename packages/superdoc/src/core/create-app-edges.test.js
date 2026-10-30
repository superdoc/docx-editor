import { describe, it, expect, vi, beforeEach, afterEach } from 'vite-plus/test';

const createAppMock = vi.fn();
const createPiniaMock = vi.fn();
const useSuperdocStoreMock = vi.fn();
const useCommentsStoreMock = vi.fn();
const clickOutsideDirectiveMock = vi.fn();

vi.mock('vue', () => ({ createApp: createAppMock }));
vi.mock('pinia', () => ({ createPinia: createPiniaMock }));
vi.mock('@superdoc/common', () => ({ vClickOutside: clickOutsideDirectiveMock }));
vi.mock('../stores/superdoc-store', () => ({ useSuperdocStore: useSuperdocStoreMock }));
vi.mock('../stores/comments-store', () => ({ useCommentsStore: useCommentsStoreMock }));
vi.mock('../composables/use-high-contrast-mode', () => ({
  HIGH_CONTRAST_MODE_KEY: Symbol('high-contrast-mode'),
}));
vi.mock('../SuperDoc.vue', () => ({ default: { name: 'SuperDocMock' } }));

const setupAppMocks = () => {
  const originalUnmount = vi.fn();
  const app = { use: vi.fn(), directive: vi.fn(), provide: vi.fn(), unmount: originalUnmount };
  createAppMock.mockReturnValue(app);
  createPiniaMock.mockReturnValue({});
  useSuperdocStoreMock.mockReturnValue({});
  useCommentsStoreMock.mockReturnValue({});
  return { app, originalUnmount };
};

const safeDelete = (key) => {
  const desc = Object.getOwnPropertyDescriptor(globalThis, key);
  if (!desc || desc.configurable !== false) delete globalThis[key];
};

const highContrastMode = { isHighContrastMode: { value: false }, setHighContrastMode: () => {} };

describe('createSuperdocVueApp', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    safeDelete('__VUE_DEVTOOLS_GLOBAL_HOOK__');
    safeDelete('__VUE_DEVTOOLS_PLUGINS__');
  });

  afterEach(() => {
    safeDelete('__VUE_DEVTOOLS_GLOBAL_HOOK__');
    safeDelete('__VUE_DEVTOOLS_PLUGINS__');
  });

  it('returns the Vue app with all stores', async () => {
    const { app } = setupAppMocks();
    const { createSuperdocVueApp } = await import('./create-app.js');
    const result = createSuperdocVueApp({ disablePiniaDevtools: false, highContrastMode });
    expect(result.app).toBe(app);
    expect(result.pinia).toBeDefined();
    expect(result.superdocStore).toBeDefined();
    expect(result.commentsStore).toBeDefined();
  });

  it('provides the high-contrast state it was given to the app', async () => {
    const { app } = setupAppMocks();
    const { createSuperdocVueApp } = await import('./create-app.js');
    createSuperdocVueApp({ highContrastMode });
    expect(app.provide).toHaveBeenCalledWith(expect.any(Symbol), highContrastMode);
  });

  // Outcome-focused: when suppressed, the Pinia devtools plugin for this app
  // is never surfaced via the hook or queue. The test does not pin the
  // specific suppression mechanism (hook-emit patch vs. queue-push patch),
  // so it survives refactors of the strategy.
  it('keeps the Pinia devtools plugin hidden from consumers when suppressed', async () => {
    const emitSpy = vi.fn(() => 'emitted');
    globalThis.__VUE_DEVTOOLS_GLOBAL_HOOK__ = { emit: emitSpy };
    const { app } = setupAppMocks();
    const { createSuperdocVueApp } = await import('./create-app.js');
    createSuperdocVueApp({ disablePiniaDevtools: true, highContrastMode });

    const hook = globalThis.__VUE_DEVTOOLS_GLOBAL_HOOK__;
    // Hook emit for this app is swallowed
    expect(hook.emit('devtools-plugin:setup', { id: 'dev.esm.pinia', app }, vi.fn())).toBeUndefined();
    expect(emitSpy).not.toHaveBeenCalled();

    // Queue pushes for this app are dropped
    const queue = globalThis.__VUE_DEVTOOLS_PLUGINS__;
    queue.push([{ id: 'dev.esm.pinia', app }, vi.fn()]);
    expect(queue).toHaveLength(0);

    // Unrelated apps are not suppressed
    const otherApp = {};
    expect(hook.emit('devtools-plugin:setup', { id: 'dev.esm.pinia', app: otherApp }, vi.fn())).toBe('emitted');
    queue.push([{ id: 'dev.esm.pinia', app: otherApp }, vi.fn()]);
    expect(queue).toHaveLength(1);

    // Suppression lifts after unmount
    app.unmount();
    expect(hook.emit('devtools-plugin:setup', { id: 'dev.esm.pinia', app }, vi.fn())).toBe('emitted');
  });

  it('does not suppress anything when disablePiniaDevtools is false', async () => {
    const emitSpy = vi.fn(() => 'emitted');
    globalThis.__VUE_DEVTOOLS_GLOBAL_HOOK__ = { emit: emitSpy };
    const { app } = setupAppMocks();
    const { createSuperdocVueApp } = await import('./create-app.js');
    createSuperdocVueApp({ disablePiniaDevtools: false, highContrastMode });

    const hook = globalThis.__VUE_DEVTOOLS_GLOBAL_HOOK__;
    expect(hook.emit('devtools-plugin:setup', { id: 'dev.esm.pinia', app }, vi.fn())).toBe('emitted');
    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  it('cleans up suppression state when app initialization throws', async () => {
    const emitSpy = vi.fn(() => 'emitted');
    globalThis.__VUE_DEVTOOLS_GLOBAL_HOOK__ = { emit: emitSpy };
    const { app } = setupAppMocks();
    app.use.mockImplementation(() => {
      throw new Error('init failed');
    });
    const { createSuperdocVueApp } = await import('./create-app.js');
    expect(() => createSuperdocVueApp({ disablePiniaDevtools: true, highContrastMode })).toThrow('init failed');

    const hook = globalThis.__VUE_DEVTOOLS_GLOBAL_HOOK__;
    expect(hook.emit('devtools-plugin:setup', { id: 'dev.esm.pinia', app }, vi.fn())).toBe('emitted');
  });
});
