import { markRaw } from 'vue';

export function markRawComponent(component: unknown): unknown {
  if ((typeof component === 'object' && component !== null) || typeof component === 'function') {
    return markRaw(component);
  }
  return component;
}
