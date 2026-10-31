import { describe, it, expect, vi, beforeEach, afterEach } from 'vite-plus/test';

const createAppMock = vi.fn();
const createPiniaMock = vi.fn();
const useSuperdocStoreMock = vi.fn();
const useCommentsStoreMock = vi.fn();
const clickOutsideDirectiveMock = vi.fn();

vi.mock('vue', () => ({
  createApp: createAppMock,
}));

vi.mock('pinia', () => ({
  createPinia: createPiniaMock,
}));

vi.mock('@superdoc/common', () => ({
  vClickOutside: clickOutsideDirectiveMock,
}));

vi.mock('../stores/superdoc-store', () => ({
  useSuperdocStore: useSuperdocStoreMock,
}));

vi.mock('../stores/comments-store', () => ({
  useCommentsStore: useCommentsStoreMock,
}));

vi.mock('../composables/use-high-contrast-mode', () => ({
  HIGH_CONTRAST_MODE_KEY: Symbol('high-contrast-mode'),
}));

vi.mock('../SuperDoc.vue', () => ({
  default: { name: 'SuperDocMock' },
}));

const setupAppMocks = () => {
  const originalUnmount = vi.fn();
  const app = {
    use: vi.fn(),
    directive: vi.fn(),
    provide: vi.fn(),
    unmount: originalUnmount,
  };

  createAppMock.mockReturnValue(app);
  createPiniaMock.mockReturnValue({ id: 'pinia-instance' });
  useSuperdocStoreMock.mockReturnValue({ id: 'superdoc-store' });
  useCommentsStoreMock.mockReturnValue({ id: 'comments-store' });

  return { app, originalUnmount };
};

const highContrastMode = { isHighContrastMode: { value: false }, setHighContrastMode: () => {} };

describe('createSuperdocVueApp', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete globalThis.__VUE_DEVTOOLS_GLOBAL_HOOK__;
    delete globalThis.__VUE_DEVTOOLS_PLUGINS__;
  });

  afterEach(() => {
    delete globalThis.__VUE_DEVTOOLS_GLOBAL_HOOK__;
    delete globalThis.__VUE_DEVTOOLS_PLUGINS__;
  });

  it('keeps Pinia devtools setup suppressed for stores created after initialization', async () => {
    const emitSpy = vi.fn(() => 'emitted');
    globalThis.__VUE_DEVTOOLS_GLOBAL_HOOK__ = { emit: emitSpy };
    const { app, originalUnmount } = setupAppMocks();
    const { createSuperdocVueApp } = await import('./create-app.js');

    createSuperdocVueApp({ disablePiniaDevtools: true, highContrastMode });

    const hook = globalThis.__VUE_DEVTOOLS_GLOBAL_HOOK__;
    expect(hook.emit('devtools-plugin:setup', { id: 'dev.esm.pinia', app }, vi.fn())).toBeUndefined();
    expect(emitSpy).not.toHaveBeenCalled();

    expect(hook.emit('devtools-plugin:setup', { id: 'dev.esm.pinia', app: {} }, vi.fn())).toBe('emitted');
    expect(emitSpy).toHaveBeenCalledTimes(1);

    app.unmount();
    expect(originalUnmount).toHaveBeenCalledTimes(1);

    expect(hook.emit('devtools-plugin:setup', { id: 'dev.esm.pinia', app }, vi.fn())).toBe('emitted');
    expect(emitSpy).toHaveBeenCalledTimes(2);
  });

  it('does not suppress Pinia devtools setup when disablePiniaDevtools is false', async () => {
    const emitSpy = vi.fn(() => 'emitted');
    globalThis.__VUE_DEVTOOLS_GLOBAL_HOOK__ = { emit: emitSpy };
    const { app, originalUnmount } = setupAppMocks();
    const { createSuperdocVueApp } = await import('./create-app.js');

    createSuperdocVueApp({ disablePiniaDevtools: false, highContrastMode });

    const hook = globalThis.__VUE_DEVTOOLS_GLOBAL_HOOK__;
    expect(hook.emit('devtools-plugin:setup', { id: 'dev.esm.pinia', app }, vi.fn())).toBe('emitted');
    expect(emitSpy).toHaveBeenCalledTimes(1);

    app.unmount();
    expect(originalUnmount).toHaveBeenCalledTimes(1);
  });

  it('purges devtools plugin queue entries for suppressed app when hook is absent', async () => {
    const { app } = setupAppMocks();

    app.use.mockImplementation(() => {
      globalThis.__VUE_DEVTOOLS_PLUGINS__ = globalThis.__VUE_DEVTOOLS_PLUGINS__ || [];
      globalThis.__VUE_DEVTOOLS_PLUGINS__.push([{ id: 'dev.esm.pinia', app, label: 'Pinia' }, vi.fn()]);
    });

    const { createSuperdocVueApp } = await import('./create-app.js');
    createSuperdocVueApp({ disablePiniaDevtools: true, highContrastMode });

    expect(globalThis.__VUE_DEVTOOLS_PLUGINS__).toHaveLength(0);
  });

  it('does not purge devtools plugin queue entries for other apps', async () => {
    const { app } = setupAppMocks();
    const otherApp = { id: 'other-app' };

    app.use.mockImplementation(() => {
      globalThis.__VUE_DEVTOOLS_PLUGINS__ = globalThis.__VUE_DEVTOOLS_PLUGINS__ || [];
      globalThis.__VUE_DEVTOOLS_PLUGINS__.push(
        [{ id: 'dev.esm.pinia', app, label: 'Pinia' }, vi.fn()],
        [{ id: 'dev.esm.pinia', app: otherApp, label: 'Pinia' }, vi.fn()],
      );
    });

    const { createSuperdocVueApp } = await import('./create-app.js');
    createSuperdocVueApp({ disablePiniaDevtools: true, highContrastMode });

    expect(globalThis.__VUE_DEVTOOLS_PLUGINS__).toHaveLength(1);
    expect(globalThis.__VUE_DEVTOOLS_PLUGINS__[0][0].app).toBe(otherApp);
  });

  it('does not purge queue when disablePiniaDevtools is false', async () => {
    const { app } = setupAppMocks();

    app.use.mockImplementation(() => {
      globalThis.__VUE_DEVTOOLS_PLUGINS__ = globalThis.__VUE_DEVTOOLS_PLUGINS__ || [];
      globalThis.__VUE_DEVTOOLS_PLUGINS__.push([{ id: 'dev.esm.pinia', app, label: 'Pinia' }, vi.fn()]);
    });

    const { createSuperdocVueApp } = await import('./create-app.js');
    createSuperdocVueApp({ disablePiniaDevtools: false, highContrastMode });

    expect(globalThis.__VUE_DEVTOOLS_PLUGINS__).toHaveLength(1);
  });

  it('intercepts late queue push for suppressed app when hook is absent at init', async () => {
    const { app } = setupAppMocks();
    const { createSuperdocVueApp } = await import('./create-app.js');

    createSuperdocVueApp({ disablePiniaDevtools: true, highContrastMode });

    const queue = globalThis.__VUE_DEVTOOLS_PLUGINS__;
    expect(queue).toBeInstanceOf(Array);
    expect(queue).toHaveLength(0);

    queue.push([{ id: 'dev.esm.pinia', app }, vi.fn()]);
    expect(queue).toHaveLength(0);

    const otherApp = { id: 'other-app' };
    queue.push([{ id: 'dev.esm.pinia', app: otherApp }, vi.fn()]);
    expect(queue).toHaveLength(1);
    expect(queue[0][0].app).toBe(otherApp);
  });

  it('intercepts queue replacement for suppressed app while active', async () => {
    const { app } = setupAppMocks();
    const { createSuperdocVueApp } = await import('./create-app.js');

    createSuperdocVueApp({ disablePiniaDevtools: true, highContrastMode });

    const replacementQueue = [];
    globalThis.__VUE_DEVTOOLS_PLUGINS__ = replacementQueue;

    replacementQueue.push([{ id: 'dev.esm.pinia', app }, vi.fn()]);
    expect(replacementQueue).toHaveLength(0);

    const otherApp = { id: 'other-app' };
    replacementQueue.push([{ id: 'dev.esm.pinia', app: otherApp }, vi.fn()]);
    expect(replacementQueue).toHaveLength(1);
    expect(replacementQueue[0][0].app).toBe(otherApp);
  });

  it('suppresses emit when hook is assigned after init', async () => {
    const { app } = setupAppMocks();
    const { createSuperdocVueApp } = await import('./create-app.js');

    createSuperdocVueApp({ disablePiniaDevtools: true, highContrastMode });

    const emitSpy = vi.fn(() => 'emitted');
    globalThis.__VUE_DEVTOOLS_GLOBAL_HOOK__ = { emit: emitSpy };

    const hook = globalThis.__VUE_DEVTOOLS_GLOBAL_HOOK__;
    expect(hook.emit('devtools-plugin:setup', { id: 'dev.esm.pinia', app }, vi.fn())).toBeUndefined();
    expect(emitSpy).not.toHaveBeenCalled();

    expect(hook.emit('devtools-plugin:setup', { id: 'dev.esm.pinia', app: {} }, vi.fn())).toBe('emitted');
    expect(emitSpy).toHaveBeenCalledTimes(1);

    app.unmount();

    expect(hook.emit('devtools-plugin:setup', { id: 'dev.esm.pinia', app }, vi.fn())).toBe('emitted');
    expect(emitSpy).toHaveBeenCalledTimes(2);
  });

  it('restores queue descriptor after suppression cleanup', async () => {
    const { app } = setupAppMocks();
    const { createSuperdocVueApp } = await import('./create-app.js');

    createSuperdocVueApp({ disablePiniaDevtools: true, highContrastMode });

    const descriptorDuringSuppression = Object.getOwnPropertyDescriptor(globalThis, '__VUE_DEVTOOLS_PLUGINS__');
    expect(typeof descriptorDuringSuppression?.get).toBe('function');
    expect(typeof descriptorDuringSuppression?.set).toBe('function');

    app.unmount();

    const descriptorAfterCleanup = Object.getOwnPropertyDescriptor(globalThis, '__VUE_DEVTOOLS_PLUGINS__');
    expect(descriptorAfterCleanup?.get).toBeUndefined();
    expect(descriptorAfterCleanup?.set).toBeUndefined();
  });

  it('cleans up suppression if app initialization throws', async () => {
    const emitSpy = vi.fn(() => 'emitted');
    globalThis.__VUE_DEVTOOLS_GLOBAL_HOOK__ = { emit: emitSpy };
    const { app } = setupAppMocks();
    app.use.mockImplementation(() => {
      throw new Error('app init failed');
    });
    const { createSuperdocVueApp } = await import('./create-app.js');

    expect(() => createSuperdocVueApp({ disablePiniaDevtools: true, highContrastMode })).toThrow('app init failed');

    const hook = globalThis.__VUE_DEVTOOLS_GLOBAL_HOOK__;
    expect(hook.emit('devtools-plugin:setup', { id: 'dev.esm.pinia', app }, vi.fn())).toBe('emitted');
    expect(emitSpy).toHaveBeenCalledTimes(1);
  });
});
