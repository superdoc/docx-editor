import type * as Vue from 'vue';
import { isPlainObject } from '../../helpers/object-guards.js';

type VueRuntime = typeof Vue;
type ForwardedComponentName = 'Teleport' | 'vModelCheckbox' | 'vModelSelect' | 'vModelText';
type TransitionProps = Parameters<VueRuntime['Transition']>[0];
type TransitionContext = Parameters<VueRuntime['Transition']>[1];

const runtimeKey = '__SUPERDOC_V2_BROWSER_RUNTIME__';

function isVueRuntime(value: unknown): value is VueRuntime {
  return isPlainObject(value) && typeof value.createApp === 'function';
}

function runtime(): VueRuntime {
  const installed: unknown = Reflect.get(globalThis, runtimeKey);
  const vue: unknown = isPlainObject(installed) ? installed.vue : undefined;
  if (!isVueRuntime(vue))
    throw new Error(
      'SuperDoc rendering runtime is unavailable; initialize SuperDoc before rendering built-in surfaces.',
    );
  return vue;
}

function component(name: ForwardedComponentName): object {
  return new Proxy(
    {},
    {
      get(_target, key) {
        return Reflect.get(runtime()[name], key);
      },
      set(_target, key, value) {
        Reflect.set(runtime()[name], key, value);
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

export function defineComponent(options: object, extraOptions?: object): object {
  return typeof options === 'function' ? { name: options.name, ...extraOptions, setup: options } : options;
}

export const Transition = new Proxy(
  (props: TransitionProps, context: TransitionContext) => runtime().Transition(props, context),
  {
    get(_target, key) {
      return Reflect.get(runtime().Transition, key);
    },
    set(_target, key, value) {
      Reflect.set(runtime().Transition, key, value);
      return true;
    },
    has(_target, key) {
      return key in runtime().Transition;
    },
  },
);

export const Fragment = Symbol.for('v-fgt');
export const Teleport = component('Teleport');
export function computed(...args: Parameters<VueRuntime['computed']>): ReturnType<VueRuntime['computed']> {
  return runtime().computed(...args);
}
export function createApp(...args: Parameters<VueRuntime['createApp']>): ReturnType<VueRuntime['createApp']> {
  return runtime().createApp(...args);
}
export function createBlock(...args: Parameters<VueRuntime['createBlock']>): ReturnType<VueRuntime['createBlock']> {
  return runtime().createBlock(...args);
}
export function createCommentVNode(
  ...args: Parameters<VueRuntime['createCommentVNode']>
): ReturnType<VueRuntime['createCommentVNode']> {
  return runtime().createCommentVNode(...args);
}
export function createElementBlock(
  ...args: Parameters<VueRuntime['createElementBlock']>
): ReturnType<VueRuntime['createElementBlock']> {
  return runtime().createElementBlock(...args);
}
export function createElementVNode(
  ...args: Parameters<VueRuntime['createElementVNode']>
): ReturnType<VueRuntime['createElementVNode']> {
  return runtime().createElementVNode(...args);
}
export function createStaticVNode(
  ...args: Parameters<VueRuntime['createStaticVNode']>
): ReturnType<VueRuntime['createStaticVNode']> {
  return runtime().createStaticVNode(...args);
}
export function createTextVNode(
  ...args: Parameters<VueRuntime['createTextVNode']>
): ReturnType<VueRuntime['createTextVNode']> {
  return runtime().createTextVNode(...args);
}
export function createVNode(...args: Parameters<VueRuntime['createVNode']>): ReturnType<VueRuntime['createVNode']> {
  return runtime().createVNode(...args);
}
export function defineAsyncComponent(
  ...args: Parameters<VueRuntime['defineAsyncComponent']>
): ReturnType<VueRuntime['defineAsyncComponent']> {
  return runtime().defineAsyncComponent(...args);
}
export function effectScope(...args: Parameters<VueRuntime['effectScope']>): ReturnType<VueRuntime['effectScope']> {
  return runtime().effectScope(...args);
}
export function getCurrentInstance(
  ...args: Parameters<VueRuntime['getCurrentInstance']>
): ReturnType<VueRuntime['getCurrentInstance']> {
  return runtime().getCurrentInstance(...args);
}
export function getCurrentScope(
  ...args: Parameters<VueRuntime['getCurrentScope']>
): ReturnType<VueRuntime['getCurrentScope']> {
  return runtime().getCurrentScope(...args);
}
export function guardReactiveProps(
  ...args: Parameters<VueRuntime['guardReactiveProps']>
): ReturnType<VueRuntime['guardReactiveProps']> {
  return runtime().guardReactiveProps(...args);
}
export function h(...args: Parameters<VueRuntime['h']>): ReturnType<VueRuntime['h']> {
  return runtime().h(...args);
}
export function hasInjectionContext(
  ...args: Parameters<VueRuntime['hasInjectionContext']>
): ReturnType<VueRuntime['hasInjectionContext']> {
  return runtime().hasInjectionContext(...args);
}
export function inject(...args: Parameters<VueRuntime['inject']>): ReturnType<VueRuntime['inject']> {
  return runtime().inject(...args);
}
export function isReactive(...args: Parameters<VueRuntime['isReactive']>): ReturnType<VueRuntime['isReactive']> {
  return runtime().isReactive(...args);
}
export function isRef(...args: Parameters<VueRuntime['isRef']>): ReturnType<VueRuntime['isRef']> {
  return runtime().isRef(...args);
}
export function markRaw(...args: Parameters<VueRuntime['markRaw']>): ReturnType<VueRuntime['markRaw']> {
  return runtime().markRaw(...args);
}
export function mergeProps(...args: Parameters<VueRuntime['mergeProps']>): ReturnType<VueRuntime['mergeProps']> {
  return runtime().mergeProps(...args);
}
export function nextTick(...args: Parameters<VueRuntime['nextTick']>): ReturnType<VueRuntime['nextTick']> {
  return runtime().nextTick(...args);
}
export function normalizeClass(
  ...args: Parameters<VueRuntime['normalizeClass']>
): ReturnType<VueRuntime['normalizeClass']> {
  return runtime().normalizeClass(...args);
}
export function normalizeProps(
  ...args: Parameters<VueRuntime['normalizeProps']>
): ReturnType<VueRuntime['normalizeProps']> {
  return runtime().normalizeProps(...args);
}
export function normalizeStyle(
  ...args: Parameters<VueRuntime['normalizeStyle']>
): ReturnType<VueRuntime['normalizeStyle']> {
  return runtime().normalizeStyle(...args);
}
export function onActivated(...args: Parameters<VueRuntime['onActivated']>): ReturnType<VueRuntime['onActivated']> {
  return runtime().onActivated(...args);
}
export function onBeforeUnmount(
  ...args: Parameters<VueRuntime['onBeforeUnmount']>
): ReturnType<VueRuntime['onBeforeUnmount']> {
  return runtime().onBeforeUnmount(...args);
}
export function onDeactivated(
  ...args: Parameters<VueRuntime['onDeactivated']>
): ReturnType<VueRuntime['onDeactivated']> {
  return runtime().onDeactivated(...args);
}
export function onMounted(...args: Parameters<VueRuntime['onMounted']>): ReturnType<VueRuntime['onMounted']> {
  return runtime().onMounted(...args);
}
export function onScopeDispose(
  ...args: Parameters<VueRuntime['onScopeDispose']>
): ReturnType<VueRuntime['onScopeDispose']> {
  return runtime().onScopeDispose(...args);
}
export function openBlock(...args: Parameters<VueRuntime['openBlock']>): ReturnType<VueRuntime['openBlock']> {
  return runtime().openBlock(...args);
}
export function provide(...args: Parameters<VueRuntime['provide']>): ReturnType<VueRuntime['provide']> {
  return runtime().provide(...args);
}
export function reactive(...args: Parameters<VueRuntime['reactive']>): ReturnType<VueRuntime['reactive']> {
  return runtime().reactive(...args);
}
export function readonly(...args: Parameters<VueRuntime['readonly']>): ReturnType<VueRuntime['readonly']> {
  return runtime().readonly(...args);
}
export function ref(...args: Parameters<VueRuntime['ref']>): ReturnType<VueRuntime['ref']> {
  return runtime().ref(...args);
}
export function renderList(...args: Parameters<VueRuntime['renderList']>): ReturnType<VueRuntime['renderList']> {
  return runtime().renderList(...args);
}
export function renderSlot(...args: Parameters<VueRuntime['renderSlot']>): ReturnType<VueRuntime['renderSlot']> {
  return runtime().renderSlot(...args);
}
export function resolveDirective(
  ...args: Parameters<VueRuntime['resolveDirective']>
): ReturnType<VueRuntime['resolveDirective']> {
  return runtime().resolveDirective(...args);
}
export function resolveDynamicComponent(
  ...args: Parameters<VueRuntime['resolveDynamicComponent']>
): ReturnType<VueRuntime['resolveDynamicComponent']> {
  return runtime().resolveDynamicComponent(...args);
}
export function shallowRef(...args: Parameters<VueRuntime['shallowRef']>): ReturnType<VueRuntime['shallowRef']> {
  return runtime().shallowRef(...args);
}
export function toDisplayString(
  ...args: Parameters<VueRuntime['toDisplayString']>
): ReturnType<VueRuntime['toDisplayString']> {
  return runtime().toDisplayString(...args);
}
export function toRaw(...args: Parameters<VueRuntime['toRaw']>): ReturnType<VueRuntime['toRaw']> {
  return runtime().toRaw(...args);
}
export function toRef(...args: Parameters<VueRuntime['toRef']>): ReturnType<VueRuntime['toRef']> {
  return runtime().toRef(...args);
}
export function toRefs(...args: Parameters<VueRuntime['toRefs']>): ReturnType<VueRuntime['toRefs']> {
  return runtime().toRefs(...args);
}
export function unref(...args: Parameters<VueRuntime['unref']>): ReturnType<VueRuntime['unref']> {
  return runtime().unref(...args);
}
export function useAttrs(...args: Parameters<VueRuntime['useAttrs']>): ReturnType<VueRuntime['useAttrs']> {
  return runtime().useAttrs(...args);
}
export function useSlots(...args: Parameters<VueRuntime['useSlots']>): ReturnType<VueRuntime['useSlots']> {
  return runtime().useSlots(...args);
}
export const vModelCheckbox = component('vModelCheckbox');
export const vModelSelect = component('vModelSelect');
export const vModelText = component('vModelText');
export function watch(...args: Parameters<VueRuntime['watch']>): ReturnType<VueRuntime['watch']> {
  return runtime().watch(...args);
}
export function withCtx(...args: Parameters<VueRuntime['withCtx']>): ReturnType<VueRuntime['withCtx']> {
  return runtime().withCtx(...args);
}
export function withDirectives(
  ...args: Parameters<VueRuntime['withDirectives']>
): ReturnType<VueRuntime['withDirectives']> {
  return runtime().withDirectives(...args);
}
export function withKeys(...args: Parameters<VueRuntime['withKeys']>): ReturnType<VueRuntime['withKeys']> {
  return runtime().withKeys(...args);
}
export function withModifiers(
  ...args: Parameters<VueRuntime['withModifiers']>
): ReturnType<VueRuntime['withModifiers']> {
  return runtime().withModifiers(...args);
}
