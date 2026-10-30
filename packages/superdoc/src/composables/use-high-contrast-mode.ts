import { inject, readonly, ref, type InjectionKey, type Ref } from 'vue';

export interface HighContrastMode {
  isHighContrastMode: Readonly<Ref<boolean>>;
  setHighContrastMode: (value: boolean) => void;
}

export const HIGH_CONTRAST_MODE_KEY: InjectionKey<HighContrastMode> = Symbol('superdoc-high-contrast-mode');

export function createHighContrastMode(): HighContrastMode {
  const isHighContrastMode = ref(false);
  return {
    isHighContrastMode,
    setHighContrastMode: (value: boolean) => {
      isHighContrastMode.value = value;
    },
  };
}

function createHighContrastOff(): HighContrastMode {
  return {
    isHighContrastMode: readonly(ref(false)),
    setHighContrastMode: () => {},
  };
}

export function useHighContrastMode(): HighContrastMode {
  return inject(HIGH_CONTRAST_MODE_KEY, createHighContrastOff, true);
}
