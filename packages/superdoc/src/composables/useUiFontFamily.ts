import { computed, getCurrentInstance, type ComputedRef } from 'vue';
import { isPlainObject } from '../helpers/object-guards.js';

/**
 * The default font-family to use for SuperDoc UI surfaces when no custom font is configured.
 * This constant ensures consistency across the application.
 */
const DEFAULT_UI_FONT_FAMILY = 'Arial, Helvetica, sans-serif';

function configuredUiFontFamily(proxy: object | null | undefined): unknown {
  const superdoc: unknown = proxy ? Reflect.get(proxy, '$superdoc') : undefined;
  const config = isPlainObject(superdoc) ? superdoc.config : undefined;
  return isPlainObject(config) ? config.uiDisplayFallbackFont : undefined;
}

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
 */
export function useUiFontFamily(): { uiFontFamily: ComputedRef<string> } {
  const instance = getCurrentInstance();

  const uiFontFamily = computed(() => {
    const configured = configuredUiFontFamily(instance?.proxy);

    if (typeof configured === 'string' && configured.trim()) {
      return configured.trim();
    }

    return DEFAULT_UI_FONT_FAMILY;
  });

  return {
    uiFontFamily,
  };
}
