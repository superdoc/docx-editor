import type { Run, TextRun } from '@superdoc/contracts';

/**
 * Type guard to check if a run has a string property.
 *
 * @param run - The run to check
 * @param prop - The property name to check
 * @returns True if the run has the property and it's a string
 */
export const hasStringProp = (run: Run, prop: string): run is Run & Record<string, string> => {
  return prop in run && typeof (run as Record<string, unknown>)[prop] === 'string';
};

/**
 * Type guard to check if a run has a number property.
 *
 * @param run - The run to check
 * @param prop - The property name to check
 * @returns True if the run has the property and it's a number
 */
export const hasNumberProp = (run: Run, prop: string): run is Run & Record<string, number> => {
  return prop in run && typeof (run as Record<string, unknown>)[prop] === 'number';
};

/**
 * Type guard to check if a run has a boolean property.
 *
 * @param run - The run to check
 * @param prop - The property name to check
 * @returns True if the run has the property and it's a boolean
 */
export const hasBooleanProp = (run: Run, prop: string): run is Run & Record<string, boolean> => {
  return prop in run && typeof (run as Record<string, unknown>)[prop] === 'boolean';
};

/**
 * Safely gets a string property from a run, with type narrowing.
 *
 * @param run - The run to get the property from
 * @param prop - The property name
 * @returns The string value or empty string if not present
 */
export const getRunStringProp = (run: Run, prop: string): string => {
  if (hasStringProp(run, prop)) {
    return run[prop];
  }
  return '';
};

/**
 * Safely gets a number property from a run, with type narrowing.
 *
 * @param run - The run to get the property from
 * @param prop - The property name
 * @returns The number value or 0 if not present
 */
export const getRunNumberProp = (run: Run, prop: string): number => {
  if (hasNumberProp(run, prop)) {
    return run[prop];
  }
  return 0;
};

/**
 * Safely gets a boolean property from a run, with type narrowing.
 *
 * @param run - The run to get the property from
 * @param prop - The property name
 * @returns The boolean value or false if not present
 */
export const getRunBooleanProp = (run: Run, prop: string): boolean => {
  if (hasBooleanProp(run, prop)) {
    return run[prop];
  }
  return false;
};

/**
 * Safely gets the underline style from a run.
 * Handles the object-shaped underline property { style?, color? }.
 *
 * @param run - The run to get the underline style from
 * @returns The underline style or empty string if not present
 */
export const getRunUnderlineStyle = (run: Run): string => {
  if ('underline' in run && typeof run.underline === 'boolean') {
    return run.underline ? 'single' : '';
  }
  if ('underline' in run && run.underline && typeof run.underline === 'object') {
    return (run.underline as { style?: string }).style ?? '';
  }
  return '';
};

/**
 * Safely gets the underline color from a run.
 * Handles the object-shaped underline property { style?, color? }.
 *
 * @param run - The run to get the underline color from
 * @returns The underline color or empty string if not present
 */
export const getRunUnderlineColor = (run: Run): string => {
  if ('underline' in run && run.underline && typeof run.underline === 'object') {
    return (run.underline as { color?: string }).color ?? '';
  }
  return '';
};

/**
 * Applies data-* attributes from a text run to a DOM element.
 * Validates attribute names and safely sets them on the element.
 * Invalid or unsafe attributes are skipped with development-mode logging.
 *
 * @param element - The HTML element to apply attributes to
 * @param dataAttrs - Record of data-* attribute key-value pairs from the text run
 *
 * @example
 * ```typescript
 * const span = document.createElement('span');
 * applyRunDataAttributes(span, { 'data-id': '123', 'data-name': 'test' });
 * // span now has: <span data-id="123" data-name="test"></span>
 * ```
 */
export const applyRunDataAttributes = (element: HTMLElement, dataAttrs?: Record<string, string>): void => {
  if (!dataAttrs) return;
  Object.entries(dataAttrs).forEach(([key, value]) => {
    if (typeof key !== 'string' || !key.toLowerCase().startsWith('data-')) return;
    if (typeof value !== 'string') return;
    try {
      element.setAttribute(key, value);
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[DomPainter] Failed to set data attribute "${key}":`, error);
      }
    }
  });
};

const stableDataAttrs = (attrs: Record<string, string> | undefined): Record<string, string> | undefined => {
  if (!attrs) return undefined;
  const keys = Object.keys(attrs).sort();
  const out: Record<string, string> = {};
  keys.forEach((key) => {
    out[key] = attrs[key]!;
  });
  return out;
};

export const textRunMergeSignature = (run: TextRun): string =>
  JSON.stringify({
    kind: run.kind ?? 'text',
    vanish: run.vanish ?? false,
    fontFamily: run.fontFamily,
    fontSize: run.fontSize,
    bold: run.bold ?? false,
    italic: run.italic ?? false,
    letterSpacing: run.letterSpacing ?? null,
    horizontalScale: run.horizontalScale ?? null,
    color: run.color ?? null,
    underline: run.underline ?? null,
    strike: run.strike ?? false,
    // The legacy effect flags belong in the merge signature for the same reason
    // `strike` does: two neighbouring runs that differ only in one of them are
    // not the same span, and merging them would paint one run's effect over the
    // other's text.
    doubleStrike: run.doubleStrike ?? false,
    outline: run.outline ?? false,
    shadow: run.shadow ?? false,
    emboss: run.emboss ?? false,
    imprint: run.imprint ?? false,
    highlight: run.highlight ?? null,
    textTransform: run.textTransform ?? null,
    textEffects: run.textEffects ?? null,
    token: run.token ?? null,
    pageNumberFieldFormat: run.pageNumberFieldFormat ?? null,
    pageRefMetadata: run.pageRefMetadata ?? null,
    trackedChange: run.trackedChange ?? null,
    trackedChanges: run.trackedChanges ?? null,
    sdt: run.sdt ?? null,
    link: run.link ?? null,
    comments: run.comments ?? null,
    dataAttrs: stableDataAttrs(run.dataAttrs) ?? null,
    bidi: run.bidi ?? null,
  });
