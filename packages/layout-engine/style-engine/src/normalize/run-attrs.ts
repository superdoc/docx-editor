/**
 * Editor-neutral run-attribute normalization.
 *
 * Maps the typed style-engine `RunProperties` into the visual subset of
 * `@superdoc/contracts` `TextRun` attrs that the v2 review adapter is
 * allowed to emit from resolved properties alone.
 *
 * Theme font / theme color resolution is done here, against the compiled
 * theme palette / font scheme owned by `@superdoc/style-engine/ooxml`'s
 * `WordStyleModel`. `auto` is intentionally returned as `undefined` so the
 * painter applies the document-safe default rather than inheriting the
 * app-shell color (a red flag for the v2 render path).
 */

import { normalizeBaselineShift } from '@superdoc/contracts';
import { toCssFontFamily } from '@superdoc/font-utils';

import type { RunProperties, UnderlineProperties } from '../ooxml/types.js';
import type { WordThemeColorPalette, WordThemeFontScheme } from '../ooxml/word-style-model/parse-theme.js';
import { applyThemeTintShade, normalizeHexColor, resolveThemeColor } from './colors.js';
import { halfPointsToPx, twipsToPx } from './units.js';
import type { TextRunStyleAttrs } from './types.js';

export interface NormalizeRunAttrsContext {
  /** Compiled theme color palette from the Word style model. */
  themeColors?: WordThemeColorPalette;
  /** Compiled theme font scheme. */
  themeFontScheme?: WordThemeFontScheme;
  /**
   * Resolved background color in which the run will render (e.g. shaded cell
   * background). When set and the run color resolves to `auto`, the
   * normalizer picks a contrasting color so dark-on-dark text does not
   * silently render unreadable inside shaded cells.
   */
  backgroundColor?: string;
}

const HIGHLIGHT_NAMED_COLORS: Readonly<Record<string, string>> = {
  black: '#000000',
  blue: '#0000FF',
  cyan: '#00FFFF',
  green: '#00FF00',
  magenta: '#FF00FF',
  red: '#FF0000',
  yellow: '#FFFF00',
  white: '#FFFFFF',
  darkBlue: '#000080',
  darkCyan: '#008080',
  darkGreen: '#008000',
  darkMagenta: '#800080',
  darkRed: '#800000',
  darkYellow: '#808000',
  darkGray: '#808080',
  lightGray: '#C0C0C0',
};

export function normalizeRunAttrsFromOoxml(
  props: RunProperties | null | undefined,
  context: NormalizeRunAttrsContext = {},
): TextRunStyleAttrs {
  const out: TextRunStyleAttrs = {};
  if (!props) return out;

  if (props.bold != null) out.bold = props.bold === true;
  if (props.italic != null) out.italic = props.italic === true;
  if (props.strike != null || props.dstrike != null) {
    out.strike = props.strike === true || props.dstrike === true;
  }
  if (props.dstrike != null) out.doubleStrike = props.dstrike === true;
  // The Word 97-2003 effect flags. They predate the `w14:` effect family, Word
  // still honours them, and they are what the Font dialog's "Effects" group
  // writes — so a document can carry them with no `w14:` counterpart at all.
  // Passed through as authored; the painter owns how they are approximated.
  if (props.outline != null) out.outline = props.outline === true;
  if (props.shadow != null) out.shadow = props.shadow === true;
  if (props.emboss != null) out.emboss = props.emboss === true;
  if (props.imprint != null) out.imprint = props.imprint === true;
  if (props.textTransform) {
    out.textTransform = props.textTransform;
    out.allCaps = props.textTransform === 'uppercase';
  }
  if (props.smallCaps != null) out.smallCaps = props.smallCaps === true;

  const fontFamily = resolveFontFamily(props, context.themeFontScheme);
  const cssFontFamily = toCssFontFamily(fontFamily);
  if (cssFontFamily) out.fontFamily = cssFontFamily;

  const fontSize = resolveFontSize(props.fontSize);
  if (fontSize != null) out.fontSize = fontSize;

  const color = resolveColor(props, context.themeColors);
  const autoContrastColor = context.backgroundColor ? pickContrastingColor(context.backgroundColor) : undefined;
  if (autoContrastColor === '#FFFFFF' && (!color || color.toUpperCase() === '#000000' || isExplicitAutoColor(props))) {
    out.color = autoContrastColor;
  } else if (color) {
    out.color = color;
  }

  const highlight = resolveHighlight(props, context.themeColors);
  if (highlight) out.highlight = highlight;

  const underline = mapUnderline(props.underline);
  if (underline) out.underline = underline;

  if (props.vertAlign === 'superscript' || props.vertAlign === 'subscript' || props.vertAlign === 'baseline') {
    out.vertAlign = props.vertAlign;
  }

  const baselineShift = normalizeBaselineShift(
    props.position != null && Number.isFinite(props.position) ? props.position / 2 : undefined,
  );
  if (baselineShift != null) {
    // w:position is stored in half-points (positive = raise, negative = lower).
    out.baselineShift = baselineShift;
  }

  if (props.letterSpacing != null && Number.isFinite(props.letterSpacing) && props.letterSpacing !== 0) {
    out.letterSpacing = twipsToPx(props.letterSpacing);
  }

  const horizontalScale = normalizeHorizontalScale(props.w);
  if (horizontalScale != null) out.horizontalScale = horizontalScale;

  const script = mapRunScriptContext(props);
  if (script) out.script = script;
  if (props.vanish != null) out.vanish = props.vanish === true;
  if (props.specVanish != null) out.specVanish = props.specVanish === true;
  if (props.noProof != null) out.noProof = props.noProof === true;

  // SD-3098: w:rPr/w:rtl carries the run-level bidi override signal, whether it
  // comes from direct formatting or a character-style/docDefaults cascade layer.
  // The painter reads TextRun.bidi.rtl for Word-parity dir + RLM date handling.
  if (props.rtl) out.bidi = { rtl: true };

  return out;
}

function normalizeHorizontalScale(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const normalized = value.trim().replace(/%$/, '');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return undefined;
  const percent = Number(normalized);
  if (!Number.isFinite(percent) || percent < 0 || percent > 600) return undefined;
  return percent / 100;
}

function resolveFontFamily(props: RunProperties, fontScheme?: WordThemeFontScheme): string | undefined {
  const ff = props.fontFamily;
  if (!ff) return undefined;
  // Per ECMA-376 §17.3.2.26, each script slot is independent; for the
  // ascii/hAnsi track (used by Latin text — the only thing v2 paints
  // generically right now) the resolution order is:
  //   ascii → hAnsi → asciiTheme(major/minor) → hAnsiTheme(major/minor)
  // We only fall back to eastAsia / cs slots when the Latin/hAnsi track
  // resolved to nothing. Skipping over the theme path because a sibling
  // slot has a concrete name (e.g. `cs: 'Calibri'`) drops the explicit
  // major theme intent and was the bug behind SD-style Heading1 rendering
  // as Calibri instead of Cambria.
  if (ff.ascii) return ff.ascii;
  if (ff.hAnsi) return ff.hAnsi;
  if (fontScheme) {
    const asciiTheme = ff.asciiTheme ?? ff.hAnsiTheme;
    if (asciiTheme) {
      const family = themeFontFromScheme(asciiTheme, fontScheme);
      if (family) return family;
    }
  }
  if (ff.eastAsia) return ff.eastAsia;
  if (fontScheme && ff.eastAsiaTheme) {
    const family = themeFontFromScheme(ff.eastAsiaTheme, fontScheme, 'ea');
    if (family) return family;
  }
  if (ff.cs) return ff.cs;
  if (fontScheme && ff.cstheme) {
    const family = themeFontFromScheme(ff.cstheme, fontScheme, 'cs');
    if (family) return family;
  }
  if (ff.val) return ff.val;
  return undefined;
}

function themeFontFromScheme(
  themeName: string,
  scheme: WordThemeFontScheme,
  axis: 'latin' | 'ea' | 'cs' = 'latin',
): string | undefined {
  const family = themeName.startsWith('minor') ? scheme.minor : scheme.major;
  if (!family) return undefined;
  return family[axis];
}

function resolveFontSize(fontSizeHalfPoints: number | undefined): number | undefined {
  if (fontSizeHalfPoints == null || !Number.isFinite(fontSizeHalfPoints) || fontSizeHalfPoints <= 0) {
    return undefined;
  }
  return halfPointsToPx(fontSizeHalfPoints);
}

function resolveColor(props: RunProperties, palette: WordThemeColorPalette | undefined): string | undefined {
  const color = props.color;
  if (!color) return undefined;
  // Direct hex wins; `auto` is intentionally dropped (the painter reset owns
  // the safe default; inheriting app-shell color is a red flag).
  const direct = normalizeHexColor(color.val);
  if (direct) return direct;
  if (color.themeColor) {
    const base = resolveThemeColor(color.themeColor, palette);
    if (base) {
      return applyThemeTintShade(base, color.themeTint, color.themeShade);
    }
  }
  return undefined;
}

function resolveHighlight(props: RunProperties, palette: WordThemeColorPalette | undefined): string | undefined {
  const highlight = props.highlight?.['w:val'];
  if (highlight && highlight !== 'none' && highlight !== 'clear') {
    return HIGHLIGHT_NAMED_COLORS[highlight] ?? normalizeHexColor(highlight) ?? highlight;
  }
  const highlightFill = resolveHighlightFill(props.highlight?.['w:fill']);
  if (highlightFill) return highlightFill;
  return resolveShadingFill(props.shading, palette);
}

function resolveHighlightFill(fill: string | undefined): string | undefined {
  if (!fill || fill.toLowerCase() === 'auto') return undefined;
  return normalizeHexColor(fill);
}

function resolveShadingFill(
  shading: RunProperties['shading'],
  palette: WordThemeColorPalette | undefined,
): string | undefined {
  if (!shading) return undefined;
  const directFill = resolveHighlightFill(shading.fill);
  if (directFill) return directFill;
  if (shading.themeFill && palette) {
    const base = resolveThemeColor(shading.themeFill, palette);
    if (base) {
      return applyThemeTintShade(base, shading.themeFillTint, shading.themeFillShade);
    }
  }
  return undefined;
}

function mapUnderline(underline: UnderlineProperties | undefined): TextRunStyleAttrs['underline'] | undefined {
  if (!underline) return undefined;
  const val = underline['w:val'];
  if (val === 'none' || val == null) return undefined;
  const style = mapUnderlineStyle(val);
  const out: NonNullable<TextRunStyleAttrs['underline']> = {};
  if (style) out.style = style;
  const color = normalizeHexColor(underline['w:color']);
  if (color) out.color = color;
  return Object.keys(out).length > 0 ? out : { style: 'single' };
}

function mapUnderlineStyle(
  value: string | null | undefined,
): NonNullable<TextRunStyleAttrs['underline']>['style'] | undefined {
  if (!value) return undefined;
  switch (value) {
    case 'single':
      return 'single';
    case 'double':
      return 'double';
    case 'dotted':
      return 'dotted';
    case 'dash':
    case 'dashed':
      return 'dashed';
    case 'wave':
    case 'wavy':
      return 'wavy';
    default:
      return 'single';
  }
}

function isExplicitAutoColor(props: RunProperties): boolean {
  const val = props.color?.val;
  if (typeof val !== 'string') return false;
  return val.trim().toLowerCase() === 'auto';
}

function pickContrastingColor(background: string): string | undefined {
  const hex = normalizeHexColor(background);
  if (!hex || !hex.startsWith('#') || hex.length !== 7) return undefined;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if ([r, g, b].some((c) => Number.isNaN(c))) return undefined;
  // Relative luminance approximation per WCAG sRGB heuristic.
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance < 0.5 ? '#FFFFFF' : '#000000';
}

function mapRunScriptContext(props: RunProperties): TextRunStyleAttrs['script'] | undefined {
  const cs = props.cs;
  const lang = props.lang;
  const hasLang = lang != null && (lang.val != null || lang.bidi != null || lang.eastAsia != null);
  if (cs == null && !hasLang) return undefined;

  const out: NonNullable<TextRunStyleAttrs['script']> = {};
  if (cs != null) out.complexScript = cs === true;
  if (hasLang) {
    const language: NonNullable<NonNullable<TextRunStyleAttrs['script']>['language']> = {};
    if (lang?.val != null) language.default = lang.val;
    if (lang?.bidi != null) language.complexScript = lang.bidi;
    if (lang?.eastAsia != null) language.eastAsian = lang.eastAsia;
    out.language = language;
  }
  return out;
}
