import type { FormatReadSelectionResult, InlineRunPatchKey, StylesStyleRunPatch } from '@superdoc/document-api';

export const STYLE_MATCH_KEYS = [
  ['bold', 'bold'],
  ['italic', 'italic'],
  ['underline', 'underline'],
  ['color', 'color'],
  ['fontSize', 'fontSize'],
  ['rFonts', 'fontFamily'],
] as const satisfies ReadonlyArray<readonly [InlineRunPatchKey, keyof StylesStyleRunPatch]>;

export const STYLE_MATCH_READ_KEYS: InlineRunPatchKey[] = [...STYLE_MATCH_KEYS.map(([readKey]) => readKey), 'rStyle'];

export interface StyleMatchPatchOptions {
  selectionUsesStyle: boolean;
}

export function buildStyleMatchPatch(
  effective: FormatReadSelectionResult,
  direct: FormatReadSelectionResult,
  options: StyleMatchPatchOptions,
): StylesStyleRunPatch {
  const patch: Record<string, unknown> = {};
  const characterStyle = direct.properties.rStyle;
  const hasCharacterStyle = characterStyle != null && characterStyle.state !== 'unset';
  for (const [readKey, styleKey] of STYLE_MATCH_KEYS) {
    const read = effective.properties[readKey];
    if (read?.state !== 'uniform') continue;
    if (options.selectionUsesStyle && !hasCharacterStyle && direct.properties[readKey]?.state === 'unset') continue;
    patch[styleKey] = toStyleValue(readKey, read.value);
  }
  return patch as StylesStyleRunPatch;
}

function toStyleValue(key: InlineRunPatchKey, value: unknown): unknown {
  switch (key) {
    case 'bold':
    case 'italic':
      return value === true;
    case 'underline':
      return underlineValue(value);
    case 'color':
      return typeof value === 'string' && value.length > 0 ? { val: value.replace(/^#/, '') } : null;
    case 'fontSize':
      return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 2) : null;
    case 'rFonts':
      return fontsValue(value);
    default:
      return null;
  }
}

function underlineValue(value: unknown): Record<string, string> {
  if (value === true) return { val: 'single' };
  if (!value || typeof value !== 'object') return { val: 'none' };
  const underline = value as Record<string, unknown>;
  const result: Record<string, string> = {
    val: typeof underline.style === 'string' && underline.style ? underline.style : 'single',
  };
  if (typeof underline.color === 'string') result.color = underline.color;
  if (typeof underline.themeColor === 'string') result.themeColor = underline.themeColor;
  return result;
}

const FONT_SLOTS: Record<string, string> = {
  ascii: 'ascii',
  hAnsi: 'hAnsi',
  eastAsia: 'eastAsia',
  cs: 'cs',
  asciiTheme: 'asciiTheme',
  hAnsiTheme: 'hAnsiTheme',
  eastAsiaTheme: 'eastAsiaTheme',
  csTheme: 'cstheme',
  hint: 'hint',
};

function fontsValue(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object') return null;
  const result: Record<string, string> = {};
  for (const [slot, styleSlot] of Object.entries(FONT_SLOTS)) {
    const font = (value as Record<string, unknown>)[slot];
    if (typeof font === 'string' && font.length > 0) result[styleSlot] = font;
  }
  return Object.keys(result).length > 0 ? result : null;
}
