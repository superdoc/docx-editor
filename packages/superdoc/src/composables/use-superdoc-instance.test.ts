import { describe, it, expect } from 'vite-plus/test';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { useSuperDocInstance, type SuperDocInstanceAccess } from './use-superdoc-instance.js';

function mountProbe(globalProperties: Record<string, unknown>): SuperDocInstanceAccess | null {
  let access: SuperDocInstanceAccess | null = null;
  const Probe = defineComponent({
    setup() {
      access = useSuperDocInstance();
      return () => h('div');
    },
  });
  mount(Probe, { global: { config: { globalProperties } } });
  return access;
}

describe('useSuperDocInstance', () => {
  it('returns the registered SuperDoc and the component proxy', () => {
    const superdoc = { config: { documentMode: 'editing' } };
    const access = mountProbe({ $superdoc: superdoc });
    expect(access?.superdoc).toBe(superdoc);
    expect(access?.proxy.$superdoc).toBe(superdoc);
  });

  it('throws when SuperDoc is not registered on the app', () => {
    expect(() => mountProbe({})).toThrow('found no SuperDoc registered at app.config.globalProperties.$superdoc');
  });

  it('throws outside a component setup function', () => {
    expect(() => useSuperDocInstance()).toThrow('must be called during a component setup function');
  });
});
