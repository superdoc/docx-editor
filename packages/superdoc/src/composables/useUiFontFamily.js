import { computed, getCurrentInstance } from 'vue';

/**
 * The default font-family to use for SuperDoc UI surfaces when no custom font is configured.
 * This constant ensures consistency across the application.
 * @constant {string}
 */
const DEFAULT_UI_FONT_FAMILY = 'Arial, Helvetica, sans-serif';

/**
 * Vue composable that returns the computed UI font-family for SuperDoc surfaces.
 *
 * This composable centralizes the logic for determining which font-family to use
 * across all SuperDoc UI components (toolbar, comments, dropdowns, tooltips, etc.).
 * It retrieves the configured font from the SuperDoc instance's config, validates it,
 * and falls back to the default if no valid font is configured.
 *
 * The font-family is determined by checking the `uiDisplayFallbackFont` config property.
 * If it's a non-empty string, it will be used. Otherwise, the DEFAULT_UI_FONT_FAMILY
 * constant is returned.
 *
 * @returns {{ uiFontFamily: import('vue').ComputedRef<string> }} An object containing:
 *   - uiFontFamily: A computed reference to the UI font-family string
 */
export function useUiFontFamily() {
  const instance = getCurrentInstance();

  const uiFontFamily = computed(() => {
    const configured = instance?.proxy?.$superdoc?.config?.uiDisplayFallbackFont;

    // Validate that the configured value is a non-empty string
    if (typeof configured === 'string' && configured.trim()) {
      return configured.trim();
    }

    // Fall back to the default font family
    return DEFAULT_UI_FONT_FAMILY;
  });

  return {
    uiFontFamily,
  };
}
