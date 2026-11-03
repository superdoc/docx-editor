/**
 * OOXML token acceptance sets: strict, case-sensitive, per-property.
 *
 * These are the exhaustive sets of accepted values for inline property tokens.
 * Any value not in these sets is an invalid token and must produce a structured
 * diagnostic (import) or error (runtime).
 */

// ---------------------------------------------------------------------------
// ST_OnOff (bold, italic, strike)
// ---------------------------------------------------------------------------

/**
 * Accepted `w:val` values for ST_OnOff properties (case-sensitive, per OOXML spec).
 * Absent `w:val` (bare element like `<w:b/>`) normalizes to ON: handled by parsers, not here.
 */
export const ST_ON_OFF_VALUES = ['true', 'false', '1', '0', 'on', 'off'] as const;
export type StOnOffValue = (typeof ST_ON_OFF_VALUES)[number];

/** Runtime set for O(1) ST_OnOff validation. */
export const ST_ON_OFF_VALUE_SET: ReadonlySet<string> = new Set(ST_ON_OFF_VALUES);

/** ST_OnOff values that normalize to ON. */
export const ST_ON_OFF_ON_VALUES: ReadonlySet<string> = new Set(['true', '1', 'on']);

/** ST_OnOff values that normalize to OFF. */
export const ST_ON_OFF_OFF_VALUES: ReadonlySet<string> = new Set(['false', '0', 'off']);

// ---------------------------------------------------------------------------
// ST_Underline (underline w:val)
// ---------------------------------------------------------------------------

/**
 * Accepted `w:val` values for ST_Underline (exhaustive, case-sensitive).
 * `'none'` maps to OFF; all others map to ON with the specified underline type.
 */
export const ST_UNDERLINE_VALUES = [
  'single',
  'double',
  'thick',
  'dotted',
  'dottedHeavy',
  'dash',
  'dashedHeavy',
  'dashLong',
  'dashLongHeavy',
  'dotDash',
  'dashDotHeavy',
  'dotDotDash',
  'dashDotDotHeavy',
  'wave',
  'wavyHeavy',
  'wavyDouble',
  'words',
  'none',
] as const;

export type StUnderlineValue = (typeof ST_UNDERLINE_VALUES)[number];

/** Runtime set for O(1) ST_Underline validation. */
export const ST_UNDERLINE_VALUE_SET: ReadonlySet<string> = new Set(ST_UNDERLINE_VALUES);

// ---------------------------------------------------------------------------
// ST_ThemeColor (underline rich attrs: w:themeColor)
// ---------------------------------------------------------------------------

/**
 * Accepted values for ST_ThemeColor (exhaustive, case-sensitive, per ECMA-376 §17.18.97).
 */
export const ST_THEME_COLOR_VALUES = [
  'dark1',
  'light1',
  'dark2',
  'light2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'hyperlink',
  'followedHyperlink',
  'background1',
  'text1',
  'background2',
  'text2',
  'none',
] as const;

export type StThemeColorValue = (typeof ST_THEME_COLOR_VALUES)[number];

/** Runtime set for O(1) ST_ThemeColor validation. */
export const ST_THEME_COLOR_VALUE_SET: ReadonlySet<string> = new Set(ST_THEME_COLOR_VALUES);

// ---------------------------------------------------------------------------
// ST_HighlightColor (w:highlight)
// ---------------------------------------------------------------------------

/**
 * Accepted `w:val` values for `w:highlight`. A closed enumeration, unlike a
 * colour value: anything outside it produces a document Word offers to repair.
 *
 * No `StHighlightValue` alias beside it, unlike the sets above:
 * {@link SDHighlightColor} in `types/sd-props.ts` is already derived from this
 * list, and a second name for one union is a second thing to keep in step.
 */
export const ST_HIGHLIGHT_VALUES = [
  'black',
  'blue',
  'cyan',
  'green',
  'magenta',
  'red',
  'yellow',
  'white',
  'darkBlue',
  'darkCyan',
  'darkGreen',
  'darkMagenta',
  'darkRed',
  'darkYellow',
  'darkGray',
  'lightGray',
  'none',
] as const;
