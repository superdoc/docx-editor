import { createApp, type App as VueApp, type Component } from 'vue';
import { createPinia, type Pinia } from 'pinia';

import { vClickOutside } from '@superdoc/common';
import { useSuperdocStore } from '../stores/superdoc-store';
import { useCommentsStore } from '../stores/comments-store';
import App from '../SuperDoc.vue';
import { HIGH_CONTRAST_MODE_KEY, type HighContrastMode } from '../composables/use-high-contrast-mode';

const PINIA_DEVTOOLS_SETUP_EVENT = 'devtools-plugin:setup';
const PINIA_DEVTOOLS_PLUGIN_ID = 'dev.esm.pinia';

type DevtoolsQueuePush = unknown[]['push'];

interface DevtoolsHook {
  emit: (event: unknown, ...args: unknown[]) => unknown;
}

interface PiniaDevtoolsSuppressionState {
  disabledAppRefCounts: Map<unknown, number>;
  hook: DevtoolsHook | null;
  originalHookEmit: DevtoolsHook['emit'] | null;
  isHookPropertyPatched: boolean;
  originalHookPropertyDescriptor: PropertyDescriptor | null;
  hookPropertyValue: unknown;
  isQueuePropertyPatched: boolean;
  originalQueuePropertyDescriptor: PropertyDescriptor | null;
  queuePropertyValue: unknown;
  queue: unknown[] | null;
  originalQueuePush: DevtoolsQueuePush | null;
}

type DevtoolsGlobal = typeof globalThis & {
  __VUE_DEVTOOLS_PLUGINS__?: unknown;
  __VUE_DEVTOOLS_GLOBAL_HOOK__?: unknown;
};

const devtoolsGlobal: DevtoolsGlobal = globalThis;

const isUnknownArray = (value: unknown): value is unknown[] => Array.isArray(value);

const readField = (value: unknown, key: string): unknown =>
  (typeof value === 'object' && value !== null) || typeof value === 'function' ? Reflect.get(value, key) : undefined;

const isDevtoolsHook = (value: unknown): value is DevtoolsHook => typeof readField(value, 'emit') === 'function';

const piniaDevtoolsSuppressionState: PiniaDevtoolsSuppressionState = {
  disabledAppRefCounts: new Map(),
  hook: null,
  originalHookEmit: null,
  isHookPropertyPatched: false,
  originalHookPropertyDescriptor: null,
  hookPropertyValue: undefined,
  isQueuePropertyPatched: false,
  originalQueuePropertyDescriptor: null,
  queuePropertyValue: undefined,
  queue: null,
  originalQueuePush: null,
};

const isPiniaDevtoolsSetupForSuppressedApp = (event: unknown, descriptor: unknown): boolean => {
  if (event !== PINIA_DEVTOOLS_SETUP_EVENT || readField(descriptor, 'id') !== PINIA_DEVTOOLS_PLUGIN_ID) {
    return false;
  }

  const app = readField(descriptor, 'app');
  return Boolean(app) && piniaDevtoolsSuppressionState.disabledAppRefCounts.has(app);
};

const isPiniaDevtoolsQueueEntryForSuppressedApp = (entry: unknown): boolean =>
  isUnknownArray(entry) && isPiniaDevtoolsSetupForSuppressedApp(PINIA_DEVTOOLS_SETUP_EVENT, entry[0]);

const setDevtoolsQueueValue = (value: unknown[]) => {
  if (piniaDevtoolsSuppressionState.isQueuePropertyPatched) {
    piniaDevtoolsSuppressionState.queuePropertyValue = value;
    return;
  }

  devtoolsGlobal.__VUE_DEVTOOLS_PLUGINS__ = value;
};

const purgeDevtoolsPluginQueueForApp = (app: VueApp) => {
  const queue = devtoolsGlobal.__VUE_DEVTOOLS_PLUGINS__;
  if (!isUnknownArray(queue)) return;

  for (let i = queue.length - 1; i >= 0; i--) {
    const entry = queue[i];
    const descriptor = isUnknownArray(entry) ? entry[0] : undefined;
    if (readField(descriptor, 'id') === PINIA_DEVTOOLS_PLUGIN_ID && readField(descriptor, 'app') === app) {
      queue.splice(i, 1);
    }
  }
};

const restoreDevtoolsQueuePushPatch = () => {
  const { queue, originalQueuePush } = piniaDevtoolsSuppressionState;
  if (queue && typeof originalQueuePush === 'function') {
    queue.push = originalQueuePush;
  }

  piniaDevtoolsSuppressionState.queue = null;
  piniaDevtoolsSuppressionState.originalQueuePush = null;
};

const restoreDevtoolsHookEmitPatch = () => {
  const { hook, originalHookEmit } = piniaDevtoolsSuppressionState;
  if (hook && typeof originalHookEmit === 'function') {
    hook.emit = originalHookEmit;
  }

  piniaDevtoolsSuppressionState.hook = null;
  piniaDevtoolsSuppressionState.originalHookEmit = null;
};

const ensureDevtoolsQueuePushPatched = () => {
  const existingQueue = devtoolsGlobal.__VUE_DEVTOOLS_PLUGINS__;
  if (existingQueue == null) {
    setDevtoolsQueueValue([]);
    ensureDevtoolsQueuePushPatched();
    return;
  }

  if (!isUnknownArray(existingQueue)) {
    return;
  }

  const queue = existingQueue;

  if (piniaDevtoolsSuppressionState.queue === queue) {
    return;
  }

  restoreDevtoolsQueuePushPatch();

  const originalQueuePush = queue.push;
  if (typeof originalQueuePush !== 'function') {
    return;
  }

  piniaDevtoolsSuppressionState.queue = queue;
  piniaDevtoolsSuppressionState.originalQueuePush = originalQueuePush;

  queue.push = function patchedQueuePush(this: unknown[], ...entries: unknown[]) {
    const retainedEntries = entries.filter((entry) => !isPiniaDevtoolsQueueEntryForSuppressedApp(entry));
    if (retainedEntries.length === 0) {
      return this.length;
    }

    return originalQueuePush.apply(this, retainedEntries);
  };
};

const ensureDevtoolsQueueAssignmentPatched = () => {
  if (piniaDevtoolsSuppressionState.isQueuePropertyPatched) {
    ensureDevtoolsQueuePushPatched();
    return;
  }

  const queueDescriptor = Object.getOwnPropertyDescriptor(devtoolsGlobal, '__VUE_DEVTOOLS_PLUGINS__');
  if (queueDescriptor?.configurable === false) {
    ensureDevtoolsQueuePushPatched();
    return;
  }

  piniaDevtoolsSuppressionState.originalQueuePropertyDescriptor = queueDescriptor ?? null;
  piniaDevtoolsSuppressionState.queuePropertyValue = devtoolsGlobal.__VUE_DEVTOOLS_PLUGINS__;

  Object.defineProperty(devtoolsGlobal, '__VUE_DEVTOOLS_PLUGINS__', {
    configurable: true,
    enumerable: queueDescriptor?.enumerable ?? true,
    get() {
      return piniaDevtoolsSuppressionState.queuePropertyValue;
    },
    set(value: unknown) {
      piniaDevtoolsSuppressionState.queuePropertyValue = value;
      ensureDevtoolsQueuePushPatched();
    },
  });

  piniaDevtoolsSuppressionState.isQueuePropertyPatched = true;
  ensureDevtoolsQueuePushPatched();
};

const restoreDevtoolsQueueAssignmentPatch = () => {
  if (!piniaDevtoolsSuppressionState.isQueuePropertyPatched) {
    return;
  }

  const { queuePropertyValue, originalQueuePropertyDescriptor } = piniaDevtoolsSuppressionState;

  delete devtoolsGlobal.__VUE_DEVTOOLS_PLUGINS__;

  if (originalQueuePropertyDescriptor) {
    if ('value' in originalQueuePropertyDescriptor) {
      Object.defineProperty(devtoolsGlobal, '__VUE_DEVTOOLS_PLUGINS__', {
        configurable: originalQueuePropertyDescriptor.configurable,
        enumerable: originalQueuePropertyDescriptor.enumerable,
        writable: originalQueuePropertyDescriptor.writable,
        value: queuePropertyValue,
      });
    } else {
      Object.defineProperty(devtoolsGlobal, '__VUE_DEVTOOLS_PLUGINS__', originalQueuePropertyDescriptor);
      if (typeof originalQueuePropertyDescriptor.set === 'function') {
        originalQueuePropertyDescriptor.set.call(devtoolsGlobal, queuePropertyValue);
      }
    }
  } else if (queuePropertyValue !== undefined) {
    devtoolsGlobal.__VUE_DEVTOOLS_PLUGINS__ = queuePropertyValue;
  }

  piniaDevtoolsSuppressionState.isQueuePropertyPatched = false;
  piniaDevtoolsSuppressionState.originalQueuePropertyDescriptor = null;
  piniaDevtoolsSuppressionState.queuePropertyValue = undefined;
};

const ensureDevtoolsHookEmitPatched = () => {
  const hook = devtoolsGlobal.__VUE_DEVTOOLS_GLOBAL_HOOK__;
  if (!isDevtoolsHook(hook)) {
    return;
  }

  if (piniaDevtoolsSuppressionState.hook === hook) {
    return;
  }

  restoreDevtoolsHookEmitPatch();

  const originalHookEmit = hook.emit;
  piniaDevtoolsSuppressionState.hook = hook;
  piniaDevtoolsSuppressionState.originalHookEmit = originalHookEmit;

  hook.emit = function patchedEmit(this: unknown, event: unknown, ...args: unknown[]) {
    const [pluginDescriptor] = args;
    if (isPiniaDevtoolsSetupForSuppressedApp(event, pluginDescriptor)) {
      return undefined;
    }

    return originalHookEmit.call(this, event, ...args);
  };
};

const ensureDevtoolsHookAssignmentPatched = () => {
  if (piniaDevtoolsSuppressionState.isHookPropertyPatched) {
    ensureDevtoolsHookEmitPatched();
    return;
  }

  const hookDescriptor = Object.getOwnPropertyDescriptor(devtoolsGlobal, '__VUE_DEVTOOLS_GLOBAL_HOOK__');
  if (hookDescriptor?.configurable === false) {
    ensureDevtoolsHookEmitPatched();
    return;
  }

  piniaDevtoolsSuppressionState.originalHookPropertyDescriptor = hookDescriptor ?? null;
  piniaDevtoolsSuppressionState.hookPropertyValue = devtoolsGlobal.__VUE_DEVTOOLS_GLOBAL_HOOK__;

  Object.defineProperty(devtoolsGlobal, '__VUE_DEVTOOLS_GLOBAL_HOOK__', {
    configurable: true,
    enumerable: hookDescriptor?.enumerable ?? true,
    get() {
      return piniaDevtoolsSuppressionState.hookPropertyValue;
    },
    set(value: unknown) {
      piniaDevtoolsSuppressionState.hookPropertyValue = value;
      ensureDevtoolsHookEmitPatched();
    },
  });

  piniaDevtoolsSuppressionState.isHookPropertyPatched = true;
  ensureDevtoolsHookEmitPatched();
};

const restoreDevtoolsHookAssignmentPatch = () => {
  if (!piniaDevtoolsSuppressionState.isHookPropertyPatched) {
    return;
  }

  const { hookPropertyValue, originalHookPropertyDescriptor } = piniaDevtoolsSuppressionState;

  delete devtoolsGlobal.__VUE_DEVTOOLS_GLOBAL_HOOK__;

  if (originalHookPropertyDescriptor) {
    if ('value' in originalHookPropertyDescriptor) {
      Object.defineProperty(devtoolsGlobal, '__VUE_DEVTOOLS_GLOBAL_HOOK__', {
        configurable: originalHookPropertyDescriptor.configurable,
        enumerable: originalHookPropertyDescriptor.enumerable,
        writable: originalHookPropertyDescriptor.writable,
        value: hookPropertyValue,
      });
    } else {
      Object.defineProperty(devtoolsGlobal, '__VUE_DEVTOOLS_GLOBAL_HOOK__', originalHookPropertyDescriptor);
      if (typeof originalHookPropertyDescriptor.set === 'function') {
        originalHookPropertyDescriptor.set.call(devtoolsGlobal, hookPropertyValue);
      }
    }
  } else if (hookPropertyValue !== undefined) {
    devtoolsGlobal.__VUE_DEVTOOLS_GLOBAL_HOOK__ = hookPropertyValue;
  }

  piniaDevtoolsSuppressionState.isHookPropertyPatched = false;
  piniaDevtoolsSuppressionState.originalHookPropertyDescriptor = null;
  piniaDevtoolsSuppressionState.hookPropertyValue = undefined;
};

const restoreDevtoolsSuppressionPatchesIfIdle = () => {
  if (piniaDevtoolsSuppressionState.disabledAppRefCounts.size > 0) {
    return;
  }

  restoreDevtoolsHookEmitPatch();
  restoreDevtoolsHookAssignmentPatch();
  restoreDevtoolsQueuePushPatch();
  restoreDevtoolsQueueAssignmentPatch();
};

const setPiniaDevtoolsSuppressedForApp = (app: VueApp, isSuppressed: boolean): (() => void) => {
  if (!isSuppressed) {
    return () => {};
  }

  const refCount = piniaDevtoolsSuppressionState.disabledAppRefCounts.get(app) ?? 0;
  piniaDevtoolsSuppressionState.disabledAppRefCounts.set(app, refCount + 1);
  ensureDevtoolsHookAssignmentPatched();
  ensureDevtoolsQueueAssignmentPatched();

  return () => {
    const currentRefCount = piniaDevtoolsSuppressionState.disabledAppRefCounts.get(app);
    if (!currentRefCount) {
      return;
    }

    if (currentRefCount === 1) {
      piniaDevtoolsSuppressionState.disabledAppRefCounts.delete(app);
    } else {
      piniaDevtoolsSuppressionState.disabledAppRefCounts.set(app, currentRefCount - 1);
    }

    restoreDevtoolsSuppressionPatchesIfIdle();
  };
};

interface SuperdocVueAppOptions {
  disablePiniaDevtools?: boolean;
  highContrastMode: HighContrastMode;
}

interface SuperdocVueAppRefs {
  app: VueApp;
  pinia: Pinia;
  superdocStore: ReturnType<typeof useSuperdocStore>;
  commentsStore: ReturnType<typeof useCommentsStore>;
}

export const createSuperdocVueApp = ({
  disablePiniaDevtools = false,
  highContrastMode,
}: SuperdocVueAppOptions): SuperdocVueAppRefs => {
  const app = createApp(App as Component);
  const pinia = createPinia();
  const cleanupPiniaDevtoolsSuppression = setPiniaDevtoolsSuppressedForApp(app, disablePiniaDevtools);

  let superdocStore: ReturnType<typeof useSuperdocStore>;
  let commentsStore: ReturnType<typeof useCommentsStore>;

  try {
    app.use(pinia);
    if (disablePiniaDevtools) {
      purgeDevtoolsPluginQueueForApp(app);
    }
    app.directive('click-outside', vClickOutside);

    superdocStore = useSuperdocStore();
    commentsStore = useCommentsStore();
    app.provide(HIGH_CONTRAST_MODE_KEY, highContrastMode);
  } catch (error) {
    cleanupPiniaDevtoolsSuppression();
    throw error;
  }

  if (typeof app.unmount === 'function') {
    const originalUnmount = app.unmount.bind(app);
    app.unmount = (...args) => {
      cleanupPiniaDevtoolsSuppression();
      return originalUnmount(...args);
    };
  }

  return { app, pinia, superdocStore, commentsStore };
};
