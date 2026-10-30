import { createApp } from 'vue';
import { createPinia } from 'pinia';

import { vClickOutside } from '@superdoc/common';
import { useSuperdocStore } from '../stores/superdoc-store';
import { useCommentsStore } from '../stores/comments-store';
import App from '../SuperDoc.vue';
import { HIGH_CONTRAST_MODE_KEY } from '../composables/use-high-contrast-mode';

const PINIA_DEVTOOLS_SETUP_EVENT = 'devtools-plugin:setup';
const PINIA_DEVTOOLS_PLUGIN_ID = 'dev.esm.pinia';

const piniaDevtoolsSuppressionState = {
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

const isPiniaDevtoolsSetupForSuppressedApp = (event, descriptor) =>
  event === PINIA_DEVTOOLS_SETUP_EVENT &&
  descriptor?.id === PINIA_DEVTOOLS_PLUGIN_ID &&
  descriptor?.app &&
  piniaDevtoolsSuppressionState.disabledAppRefCounts.has(descriptor.app);

const isPiniaDevtoolsQueueEntryForSuppressedApp = (entry) =>
  Array.isArray(entry) && isPiniaDevtoolsSetupForSuppressedApp(PINIA_DEVTOOLS_SETUP_EVENT, entry[0]);

const setDevtoolsQueueValue = (value) => {
  if (piniaDevtoolsSuppressionState.isQueuePropertyPatched) {
    piniaDevtoolsSuppressionState.queuePropertyValue = value;
    return;
  }

  globalThis.__VUE_DEVTOOLS_PLUGINS__ = value;
};

const purgeDevtoolsPluginQueueForApp = (app) => {
  const queue = globalThis.__VUE_DEVTOOLS_PLUGINS__;
  if (!Array.isArray(queue)) return;

  for (let i = queue.length - 1; i >= 0; i--) {
    const [descriptor] = queue[i];
    if (descriptor?.id === PINIA_DEVTOOLS_PLUGIN_ID && descriptor?.app === app) {
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
  const existingQueue = globalThis.__VUE_DEVTOOLS_PLUGINS__;
  if (existingQueue == null) {
    setDevtoolsQueueValue([]);
    ensureDevtoolsQueuePushPatched();
    return;
  }

  if (!Array.isArray(existingQueue)) {
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

  queue.push = function patchedQueuePush(...entries) {
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

  const queueDescriptor = Object.getOwnPropertyDescriptor(globalThis, '__VUE_DEVTOOLS_PLUGINS__');
  if (queueDescriptor?.configurable === false) {
    ensureDevtoolsQueuePushPatched();
    return;
  }

  piniaDevtoolsSuppressionState.originalQueuePropertyDescriptor = queueDescriptor ?? null;
  piniaDevtoolsSuppressionState.queuePropertyValue = globalThis.__VUE_DEVTOOLS_PLUGINS__;

  Object.defineProperty(globalThis, '__VUE_DEVTOOLS_PLUGINS__', {
    configurable: true,
    enumerable: queueDescriptor?.enumerable ?? true,
    get() {
      return piniaDevtoolsSuppressionState.queuePropertyValue;
    },
    set(value) {
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

  delete globalThis.__VUE_DEVTOOLS_PLUGINS__;

  if (originalQueuePropertyDescriptor) {
    if ('value' in originalQueuePropertyDescriptor) {
      Object.defineProperty(globalThis, '__VUE_DEVTOOLS_PLUGINS__', {
        configurable: originalQueuePropertyDescriptor.configurable,
        enumerable: originalQueuePropertyDescriptor.enumerable,
        writable: originalQueuePropertyDescriptor.writable,
        value: queuePropertyValue,
      });
    } else {
      Object.defineProperty(globalThis, '__VUE_DEVTOOLS_PLUGINS__', originalQueuePropertyDescriptor);
      if (typeof originalQueuePropertyDescriptor.set === 'function') {
        originalQueuePropertyDescriptor.set.call(globalThis, queuePropertyValue);
      }
    }
  } else if (queuePropertyValue !== undefined) {
    globalThis.__VUE_DEVTOOLS_PLUGINS__ = queuePropertyValue;
  }

  piniaDevtoolsSuppressionState.isQueuePropertyPatched = false;
  piniaDevtoolsSuppressionState.originalQueuePropertyDescriptor = null;
  piniaDevtoolsSuppressionState.queuePropertyValue = undefined;
};

const ensureDevtoolsHookEmitPatched = () => {
  const hook = globalThis?.__VUE_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook || typeof hook.emit !== 'function') {
    return;
  }

  if (piniaDevtoolsSuppressionState.hook === hook) {
    return;
  }

  restoreDevtoolsHookEmitPatch();

  const originalHookEmit = hook.emit;
  piniaDevtoolsSuppressionState.hook = hook;
  piniaDevtoolsSuppressionState.originalHookEmit = originalHookEmit;

  hook.emit = function patchedEmit(event, ...args) {
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

  const hookDescriptor = Object.getOwnPropertyDescriptor(globalThis, '__VUE_DEVTOOLS_GLOBAL_HOOK__');
  if (hookDescriptor?.configurable === false) {
    ensureDevtoolsHookEmitPatched();
    return;
  }

  piniaDevtoolsSuppressionState.originalHookPropertyDescriptor = hookDescriptor ?? null;
  piniaDevtoolsSuppressionState.hookPropertyValue = globalThis.__VUE_DEVTOOLS_GLOBAL_HOOK__;

  Object.defineProperty(globalThis, '__VUE_DEVTOOLS_GLOBAL_HOOK__', {
    configurable: true,
    enumerable: hookDescriptor?.enumerable ?? true,
    get() {
      return piniaDevtoolsSuppressionState.hookPropertyValue;
    },
    set(value) {
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

  delete globalThis.__VUE_DEVTOOLS_GLOBAL_HOOK__;

  if (originalHookPropertyDescriptor) {
    if ('value' in originalHookPropertyDescriptor) {
      Object.defineProperty(globalThis, '__VUE_DEVTOOLS_GLOBAL_HOOK__', {
        configurable: originalHookPropertyDescriptor.configurable,
        enumerable: originalHookPropertyDescriptor.enumerable,
        writable: originalHookPropertyDescriptor.writable,
        value: hookPropertyValue,
      });
    } else {
      Object.defineProperty(globalThis, '__VUE_DEVTOOLS_GLOBAL_HOOK__', originalHookPropertyDescriptor);
      if (typeof originalHookPropertyDescriptor.set === 'function') {
        originalHookPropertyDescriptor.set.call(globalThis, hookPropertyValue);
      }
    }
  } else if (hookPropertyValue !== undefined) {
    globalThis.__VUE_DEVTOOLS_GLOBAL_HOOK__ = hookPropertyValue;
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

const setPiniaDevtoolsSuppressedForApp = (app, isSuppressed) => {
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

/**
 * Result of `createSuperdocVueApp()`. Internal-only: the shape is consumed
 * by `SuperDoc.#initVueApp` and is not part of the public surface.
 *
 * @typedef {Object} SuperdocVueAppRefs
 * @property {import('vue').App} app The Vue 3 app instance
 * @property {import('pinia').Pinia} pinia The Pinia store instance attached to `app`
 * @property {ReturnType<typeof useSuperdocStore>} superdocStore The SuperDoc Pinia store
 * @property {ReturnType<typeof useCommentsStore>} commentsStore The Comments Pinia store
 */

/**
 * Generate the superdoc vue app
 *
 * @param {Object} options
 * @param {boolean} [options.disablePiniaDevtools=false] Disable Pinia devtools registration for this app instance
 * @param {import('../composables/use-high-contrast-mode').HighContrastMode} options.highContrastMode The owning SuperDoc's high-contrast state, provided to the app
 * @returns {SuperdocVueAppRefs} An object containing the vue app, the pinia reference, and the superdoc/comments Pinia stores
 */
export const createSuperdocVueApp = ({ disablePiniaDevtools = false, highContrastMode }) => {
  const app = createApp(App);
  const pinia = createPinia();
  const cleanupPiniaDevtoolsSuppression = setPiniaDevtoolsSuppressedForApp(app, disablePiniaDevtools);

  let superdocStore;
  let commentsStore;

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
