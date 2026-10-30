// Built-in UI chunks consume the Vue instance installed by the main package entry.
// Keep bare Vue imports in optimized entries, where Vite retains package provenance.
const runtimeKey = '__SUPERDOC_V2_BROWSER_RUNTIME__';
function runtime() {
  const vue = globalThis[runtimeKey]?.vue;
  if (!vue)
    throw new Error(
      'SuperDoc rendering runtime is unavailable; initialize SuperDoc before rendering built-in surfaces.',
    );
  return vue;
}

function component(name) {
  return new Proxy(
    {},
    {
      get(_target, key) {
        return runtime()[name][key];
      },
      set(_target, key, value) {
        runtime()[name][key] = value;
        return true;
      },
      has(_target, key) {
        return key in runtime()[name];
      },
      ownKeys() {
        return Reflect.ownKeys(runtime()[name]);
      },
      getOwnPropertyDescriptor(_target, key) {
        const descriptor = Object.getOwnPropertyDescriptor(runtime()[name], key);
        return descriptor ? { ...descriptor, configurable: true } : undefined;
      },
    },
  );
}

export function defineComponent(options, extraOptions) {
  return typeof options === 'function' ? { name: options.name, ...extraOptions, setup: options } : options;
}

// Vue uses functional component arity to decide whether to pass slots and attrs.
// Forward its static component metadata as well as calls to the installed instance.
export const Transition = new Proxy((props, context) => runtime().Transition(props, context), {
  get(_target, key) {
    return runtime().Transition[key];
  },
  set(_target, key, value) {
    runtime().Transition[key] = value;
    return true;
  },
  has(_target, key) {
    return key in runtime().Transition;
  },
});

export const Fragment = Symbol.for('v-fgt');
export const Teleport = component('Teleport');
export function computed(...args) {
  return runtime().computed(...args);
}
export function createApp(...args) {
  return runtime().createApp(...args);
}
export function createBlock(...args) {
  return runtime().createBlock(...args);
}
export function createCommentVNode(...args) {
  return runtime().createCommentVNode(...args);
}
export function createElementBlock(...args) {
  return runtime().createElementBlock(...args);
}
export function createElementVNode(...args) {
  return runtime().createElementVNode(...args);
}
export function createStaticVNode(...args) {
  return runtime().createStaticVNode(...args);
}
export function createTextVNode(...args) {
  return runtime().createTextVNode(...args);
}
export function createVNode(...args) {
  return runtime().createVNode(...args);
}
export function defineAsyncComponent(...args) {
  return runtime().defineAsyncComponent(...args);
}
export function effectScope(...args) {
  return runtime().effectScope(...args);
}
export function getCurrentInstance(...args) {
  return runtime().getCurrentInstance(...args);
}
export function getCurrentScope(...args) {
  return runtime().getCurrentScope(...args);
}
export function guardReactiveProps(...args) {
  return runtime().guardReactiveProps(...args);
}
export function h(...args) {
  return runtime().h(...args);
}
export function hasInjectionContext(...args) {
  return runtime().hasInjectionContext(...args);
}
export function inject(...args) {
  return runtime().inject(...args);
}
export function isReactive(...args) {
  return runtime().isReactive(...args);
}
export function isRef(...args) {
  return runtime().isRef(...args);
}
export function markRaw(...args) {
  return runtime().markRaw(...args);
}
export function mergeProps(...args) {
  return runtime().mergeProps(...args);
}
export function nextTick(...args) {
  return runtime().nextTick(...args);
}
export function normalizeClass(...args) {
  return runtime().normalizeClass(...args);
}
export function normalizeProps(...args) {
  return runtime().normalizeProps(...args);
}
export function normalizeStyle(...args) {
  return runtime().normalizeStyle(...args);
}
export function onActivated(...args) {
  return runtime().onActivated(...args);
}
export function onBeforeUnmount(...args) {
  return runtime().onBeforeUnmount(...args);
}
export function onDeactivated(...args) {
  return runtime().onDeactivated(...args);
}
export function onMounted(...args) {
  return runtime().onMounted(...args);
}
export function onScopeDispose(...args) {
  return runtime().onScopeDispose(...args);
}
export function openBlock(...args) {
  return runtime().openBlock(...args);
}
export function provide(...args) {
  return runtime().provide(...args);
}
export function reactive(...args) {
  return runtime().reactive(...args);
}
export function readonly(...args) {
  return runtime().readonly(...args);
}
export function ref(...args) {
  return runtime().ref(...args);
}
export function renderList(...args) {
  return runtime().renderList(...args);
}
export function renderSlot(...args) {
  return runtime().renderSlot(...args);
}
export function resolveDirective(...args) {
  return runtime().resolveDirective(...args);
}
export function resolveDynamicComponent(...args) {
  return runtime().resolveDynamicComponent(...args);
}
export function shallowRef(...args) {
  return runtime().shallowRef(...args);
}
export function toDisplayString(...args) {
  return runtime().toDisplayString(...args);
}
export function toRaw(...args) {
  return runtime().toRaw(...args);
}
export function toRef(...args) {
  return runtime().toRef(...args);
}
export function toRefs(...args) {
  return runtime().toRefs(...args);
}
export function unref(...args) {
  return runtime().unref(...args);
}
export function useAttrs(...args) {
  return runtime().useAttrs(...args);
}
export function useSlots(...args) {
  return runtime().useSlots(...args);
}
export const vModelCheckbox = component('vModelCheckbox');
export const vModelSelect = component('vModelSelect');
export const vModelText = component('vModelText');
export function watch(...args) {
  return runtime().watch(...args);
}
export function withCtx(...args) {
  return runtime().withCtx(...args);
}
export function withDirectives(...args) {
  return runtime().withDirectives(...args);
}
export function withKeys(...args) {
  return runtime().withKeys(...args);
}
export function withModifiers(...args) {
  return runtime().withModifiers(...args);
}
