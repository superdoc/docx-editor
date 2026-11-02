import { createPinia, type Pinia } from 'pinia';
import { describe, expect, expectTypeOf, it } from 'vite-plus/test';
import { createApp } from 'vue';
import { globalPropertiesWith } from './global-properties.js';

describe('globalPropertiesWith', () => {
  it('returns a real app globalProperties object holding the given values', () => {
    const toolbar = { toolbarItems: [] };
    const properties = globalPropertiesWith({ $toolbar: toolbar });

    expect(Object.getPrototypeOf(properties)).toBe(Object.getPrototypeOf(createApp({}).config.globalProperties));
    expect(properties.$toolbar).toBe(toolbar);
    expectTypeOf(properties.$toolbar).toEqualTypeOf<{ toolbarItems: never[] }>();
  });

  it('accepts a value of the declared type for a known property', () => {
    const pinia = createPinia();
    expect(globalPropertiesWith({ $pinia: pinia }).$pinia).toBe(pinia);
  });

  it('types a known property against its declared type, so a wrong value does not compile', () => {
    type ValuesParameter<Values extends object> = Parameters<typeof globalPropertiesWith<Values>>[0];
    expectTypeOf<{ $pinia: string }>().not.toMatchTypeOf<ValuesParameter<{ $pinia: string }>>();
    expectTypeOf<{ $pinia: Pinia }>().toMatchTypeOf<ValuesParameter<{ $pinia: Pinia }>>();
  });
});
