import { getCurrentInstance, type ComponentPublicInstance } from 'vue';
import type { SuperDoc } from '../core/SuperDoc.js';

export interface SuperDocInstanceAccess {
  proxy: ComponentPublicInstance;
  superdoc: SuperDoc;
}

export function useSuperDocInstance(): SuperDocInstanceAccess {
  const instance = getCurrentInstance();
  if (!instance?.proxy) {
    throw new Error('useSuperDocInstance() must be called during a component setup function.');
  }
  const superdoc: SuperDoc | undefined = instance.appContext.config.globalProperties.$superdoc;
  if (!superdoc) {
    throw new Error('useSuperDocInstance() found no SuperDoc registered at app.config.globalProperties.$superdoc.');
  }
  return { proxy: instance.proxy, superdoc };
}
