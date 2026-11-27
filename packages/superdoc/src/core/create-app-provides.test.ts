import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { defineComponent, h, nextTick, type App } from 'vue';
import { createHighContrastMode, useHighContrastMode } from '../composables/use-high-contrast-mode.js';
import { createSuperdocVueApp } from './create-app.js';

vi.mock('../SuperDoc.vue', () => ({
  default: defineComponent({
    setup() {
      const { isHighContrastMode } = useHighContrastMode();
      return () => h('span', isHighContrastMode.value ? 'high contrast' : 'standard');
    },
  }),
}));

let app: App | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
});

describe('createSuperdocVueApp provides', () => {
  it('gives the SuperDoc component the high-contrast state it was created with', async () => {
    const highContrastMode = createHighContrastMode();
    const element = document.createElement('div');
    app = createSuperdocVueApp({ highContrastMode }).app;
    app.mount(element);
    expect(element.textContent).toBe('standard');

    highContrastMode.setHighContrastMode(true);
    await nextTick();
    expect(element.textContent).toBe('high contrast');
  });
});
