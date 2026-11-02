import { describe, it, expect } from 'vite-plus/test';
import { defineComponent, h, reactive } from 'vue';
import { mount } from '@vue/test-utils';
import { globalPropertiesWith } from '../test-support/global-properties.js';
import { useUiFontFamily } from './useUiFontFamily.js';

class FakeSuperDoc {
  config: Record<string, unknown>;

  constructor(config: Record<string, unknown>) {
    this.config = config;
  }
}

function mountFontFamily(globalProperties: Record<string, unknown>): string | null {
  let fontFamily: string | null = null;
  const Probe = defineComponent({
    setup() {
      const { uiFontFamily } = useUiFontFamily();
      fontFamily = uiFontFamily.value;
      return () => h('div');
    },
  });
  mount(Probe, { global: { config: { globalProperties: globalPropertiesWith(globalProperties) } } });
  return fontFamily;
}

describe('useUiFontFamily', () => {
  it('returns the configured font from a SuperDoc class instance, trimmed', () => {
    const superdoc = new FakeSuperDoc({ uiDisplayFallbackFont: '  Inter, sans-serif  ' });
    expect(mountFontFamily({ $superdoc: superdoc })).toBe('Inter, sans-serif');
  });

  it('returns the configured font when the config is reactive', () => {
    const superdoc = new FakeSuperDoc(reactive({ uiDisplayFallbackFont: 'Roboto, sans-serif' }));
    expect(mountFontFamily({ $superdoc: superdoc })).toBe('Roboto, sans-serif');
  });

  it('falls back to the default for a whitespace-only font', () => {
    const superdoc = new FakeSuperDoc({ uiDisplayFallbackFont: '   ' });
    expect(mountFontFamily({ $superdoc: superdoc })).toBe('Arial, Helvetica, sans-serif');
  });

  it('falls back to the default for a non-string font', () => {
    const superdoc = new FakeSuperDoc({ uiDisplayFallbackFont: 12 });
    expect(mountFontFamily({ $superdoc: superdoc })).toBe('Arial, Helvetica, sans-serif');
  });

  it('falls back to the default when the font is not configured', () => {
    const superdoc = new FakeSuperDoc({});
    expect(mountFontFamily({ $superdoc: superdoc })).toBe('Arial, Helvetica, sans-serif');
  });

  it('falls back to the default when SuperDoc is not registered', () => {
    expect(mountFontFamily({})).toBe('Arial, Helvetica, sans-serif');
  });
});
