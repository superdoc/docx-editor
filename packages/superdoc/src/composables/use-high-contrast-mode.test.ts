import { describe, it, expect } from 'vite-plus/test';
import { createApp, defineComponent, h } from 'vue';
import {
  createHighContrastMode,
  HIGH_CONTRAST_MODE_KEY,
  useHighContrastMode,
  type HighContrastMode,
} from './use-high-contrast-mode.js';

function readFromApp(provided: HighContrastMode | null): HighContrastMode {
  let read: HighContrastMode | undefined;
  const app = createApp(
    defineComponent({
      setup: () => {
        read = useHighContrastMode();
        return () => h('div');
      },
    }),
  );
  if (provided) app.provide(HIGH_CONTRAST_MODE_KEY, provided);
  app.mount(document.createElement('div'));
  app.unmount();
  return read!;
}

describe('high contrast mode', () => {
  it('starts off and follows setHighContrastMode', () => {
    const mode = createHighContrastMode();
    expect(mode.isHighContrastMode.value).toBe(false);
    mode.setHighContrastMode(true);
    expect(mode.isHighContrastMode.value).toBe(true);
  });

  it('gives each instance its own state', () => {
    const first = createHighContrastMode();
    const second = createHighContrastMode();
    first.setHighContrastMode(true);
    expect(second.isHighContrastMode.value).toBe(false);
  });

  it('reads the state provided to its app', () => {
    const provided = createHighContrastMode();
    const read = readFromApp(provided);
    provided.setHighContrastMode(true);
    expect(read.isHighContrastMode.value).toBe(true);
  });

  it('reads high contrast as off when nothing is provided', () => {
    const read = readFromApp(null);
    read.setHighContrastMode(true);
    expect(read.isHighContrastMode.value).toBe(false);
  });
});
