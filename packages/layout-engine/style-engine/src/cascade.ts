/**
 * @superdoc/style-engine/cascade
 *
 * Generic cascade utilities for OOXML style resolution.
 * This module is the SINGLE SOURCE OF TRUTH for property merging and cascade rules.
 *
 * These utilities are format-agnostic and work with plain JavaScript objects.
 * They are used by both:
 * - document runtime import/export code
 * - layout-engine's style resolution (for rendering)
 */

import { isPlainObject } from '@superdoc/contracts';
import { ParagraphProperties, RunFontFamilyProperties, RunProperties } from './ooxml/types';
import type { TableCellProperties, TableProperties } from './ooxml/styles-types';

export type PropertyObject = ParagraphProperties | RunProperties | TableCellProperties | TableProperties;

/**
 * Performs a deep merge on an ordered list of property objects.
 *
 * This is the core cascade function used throughout style resolution.
 * Properties from later objects in the array override earlier ones.
 *
 * @param propertiesArray - Ordered list of property objects to combine (low -> high priority).
 * @param options - Configuration for full overrides and special handling.
 * @returns Combined property object.
 */
export function combineProperties<T extends PropertyObject>(
  propertiesArray: T[],
  options: {
    /**
     * Keys that should completely overwrite instead of deep merge.
     * Use this for complex objects like fontFamily or color that should
     * be replaced entirely rather than merged property-by-property.
     */
    fullOverrideProps?: string[];

    /**
     * Custom merge handlers for specific keys.
     * The handler receives the accumulated target and current source,
     * and returns the new value for that key.
     */
    specialHandling?: Record<string, (target: Record<string, unknown>, source: Record<string, unknown>) => unknown>;
  } = {},
): T {
  const { fullOverrideProps = [], specialHandling = {} } = options;

  if (!propertiesArray || propertiesArray.length === 0) {
    return {} as T;
  }

  /**
   * Deep merges two objects while respecting override lists and per-key handlers.
   */
  const merge = (target: Record<string, unknown>, source: Record<string, unknown>): PropertyObject => {
    const output: Record<string, unknown> = { ...target };

    if (isPlainObject(target) && isPlainObject(source)) {
      for (const key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          const handler = specialHandling[key];

          if (handler && typeof handler === 'function') {
            // Use custom handler for this key
            output[key] = handler(output, source);
          } else if (!fullOverrideProps.includes(key) && isPlainObject(source[key])) {
            // Deep merge nested objects (unless marked for full override)
            if (key in target && isPlainObject(target[key])) {
              output[key] = merge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
            } else {
              output[key] = source[key];
            }
          } else {
            // Simple assignment (primitives or full override keys)
            output[key] = source[key];
          }
        }
      }
    }

    return output;
  };

  return propertiesArray.reduce((acc, current) => merge(acc, (current ?? {}) as Record<string, unknown>), {}) as T;
}

// ---------------------------------------------------------------------------
// Style Chain Ordering
// ---------------------------------------------------------------------------

/**
 * Combines run property objects while fully overriding certain keys.
 * This is a convenience wrapper for run properties (w:rPr).
 *
 * @param propertiesArray - Ordered list of run property objects.
 * @returns Combined run property object.
 */
// SD-2894: `<w:rFonts>` exposes four independent script slots (ascii / hAnsi / eastAsia / cs).
// Each slot can be filled either by a concrete font name (`w:ascii="Calibri"`) or a theme
// reference (`w:asciiTheme="majorBidi"`). When a higher-priority style supplies one form for a
// slot, the other form from lower-priority sources is no longer applicable and must be
// dropped — otherwise the merged run carries both, and Word resolves the concrete name as an
// override that defeats per-script theme resolution (Latin body text mapped to `majorBidi`
// then renders as Calibri Light instead of Times New Roman for Hebrew/Arab).
//
// Pair `<slot>` with `<slot>Theme`, except for the cs slot whose theme attribute is the
// lowercase `cstheme` (OOXML inconsistency, not a typo).
// Exported so runtime adapters can consume the same list instead of duplicating it
// (SD-2894 follow-up).
export const FONT_SLOT_THEME_PAIRS: Array<[keyof RunFontFamilyProperties, keyof RunFontFamilyProperties]> = [
  ['ascii', 'asciiTheme'],
  ['hAnsi', 'hAnsiTheme'],
  ['eastAsia', 'eastAsiaTheme'],
  ['cs', 'cstheme'],
];

const CONCRETE_FONT_FAMILY_KEYS: Array<keyof RunFontFamilyProperties> = [
  ...FONT_SLOT_THEME_PAIRS.map(([concreteKey]) => concreteKey),
  'val',
];

function omitInheritedFontFamilies(source: RunFontFamilyProperties): RunFontFamilyProperties {
  const result = { ...source };
  for (const key of CONCRETE_FONT_FAMILY_KEYS) {
    const value = result[key];
    if (typeof value === 'string' && value.trim().toLowerCase() === 'inherit') {
      delete result[key];
    }
  }
  return result;
}

function dropConflictingFontSlots(
  target: RunFontFamilyProperties,
  source: RunFontFamilyProperties,
): RunFontFamilyProperties {
  const result = { ...target };
  for (const [concreteKey, themeKey] of FONT_SLOT_THEME_PAIRS) {
    if (source[themeKey] != null) {
      delete result[concreteKey];
      delete result[themeKey];
    } else if (source[concreteKey] != null) {
      delete result[themeKey];
    }
  }
  return result;
}

export function combineRunProperties(propertiesArray: RunProperties[]): RunProperties {
  return combineProperties(propertiesArray, {
    fullOverrideProps: ['color', 'shading'],
    specialHandling: {
      fontFamily: (target: Record<string, unknown>, source: Record<string, unknown>): unknown => {
        const fontFamilySource = omitInheritedFontFamilies(source.fontFamily as RunFontFamilyProperties);
        const fontFamilyTarget = dropConflictingFontSlots(
          (target.fontFamily as RunFontFamilyProperties) ?? {},
          fontFamilySource,
        );
        return { ...(fontFamilyTarget as object), ...(fontFamilySource as object) };
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Indent Special Handling
// ---------------------------------------------------------------------------
/**
 * Combines indent properties with special handling for firstLine/hanging mutual exclusivity.
 *
 * @param indentChain - Ordered list of indent property objects (or objects with indent property).
 * @returns Combined indent object.
 */
export function combineIndentProperties(indentChain: ParagraphProperties[]): ParagraphProperties {
  // Extract just the indent properties from each object
  const indentOnly = indentChain.map((props) => (props.indent != null ? { indent: props.indent } : {}));

  return combineProperties(indentOnly, {
    specialHandling: {
      firstLine: (target: Record<string, unknown>, source: Record<string, unknown>): unknown => {
        // If a higher priority source defines firstLine, remove hanging from the final result
        if (target.hanging != null && source.firstLine != null) {
          delete target.hanging;
        }
        return source.firstLine;
      },
      hanging: (target: Record<string, unknown>, source: Record<string, unknown>): unknown => {
        // If a higher priority source defines hanging, remove firstLine from the final result
        if (target.firstLine != null && source.hanging != null) {
          delete target.firstLine;
        }
        return source.hanging;
      },
    },
  });
}
