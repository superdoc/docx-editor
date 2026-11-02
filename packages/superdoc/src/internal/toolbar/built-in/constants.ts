import type { DocumentFontOption, FontFamilyOption } from '@superdoc/font-system';
import type { ToolbarFontOption } from '../../../core/types/index.js';

const DEFAULT_TOOLBAR_FONT_FAMILIES: ReadonlyArray<readonly [family: string, generic: string]> = [
  ['Arial', 'sans-serif'],
  ['Arial Black', 'sans-serif'],
  ['Arial Narrow', 'sans-serif'],
  ['Baskerville Old Face', 'serif'],
  ['Bookman Old Style', 'serif'],
  ['Brush Script MT', 'cursive'],
  ['Calibri', 'sans-serif'],
  ['Century', 'serif'],
  ['Century Gothic', 'sans-serif'],
  ['Comic Sans MS', 'sans-serif'],
  ['Cooper Black', 'serif'],
  ['Courier New', 'monospace'],
  ['Garamond', 'serif'],
  ['Georgia', 'serif'],
  ['Gill Sans MT Condensed', 'sans-serif'],
  ['Helvetica', 'sans-serif'],
  ['Lucida Console', 'monospace'],
  ['Segoe UI', 'sans-serif'],
  ['Tahoma', 'sans-serif'],
  ['Times New Roman', 'serif'],
  ['Trebuchet MS', 'sans-serif'],
  ['Verdana', 'sans-serif'],
];

export const TOOLBAR_FONTS: ToolbarFontOption[] = DEFAULT_TOOLBAR_FONT_FAMILIES.map(([family, generic]) => ({
  label: family,
  key: family,
  props: {
    style: { fontFamily: `${family}, ${generic}` },
    'data-item': 'btn-fontFamily-option',
  },
}));

function normalizeToolbarFamily(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function firstToolbarFamilyToken(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  let token = '';
  let inQuote = false;
  let quoteChar = '';

  for (const char of raw) {
    if (!inQuote && (char === '"' || char === "'")) {
      inQuote = true;
      quoteChar = char;
      token += char;
      continue;
    }
    if (inQuote && char === quoteChar) {
      inQuote = false;
      quoteChar = '';
      token += char;
      continue;
    }
    if (!inQuote && char === ',') break;
    token += char;
  }

  return token.trim().replace(/^["']|["']$/g, '');
}

function compareToolbarFontOptions(a: ToolbarFontOption, b: ToolbarFontOption): number {
  return String(a.label ?? '')
    .trim()
    .localeCompare(String(b.label ?? '').trim(), 'en', { sensitivity: 'base' });
}

type ToolbarDocumentFontOption = Pick<DocumentFontOption, 'logicalFamily' | 'previewFamily'>;

export function composeToolbarFontOptions(
  documentOptions: readonly ToolbarDocumentFontOption[] | null | undefined,
  configFonts?: readonly ToolbarFontOption[],
): readonly ToolbarFontOption[] | undefined {
  if (configFonts) return configFonts;
  if (!documentOptions?.length) return undefined;
  const seen = new Set(TOOLBAR_FONTS.map((option) => normalizeToolbarFamily(option.label)));
  const merged = [...TOOLBAR_FONTS];
  for (const option of documentOptions) {
    const logicalFamily = firstToolbarFamilyToken(option.logicalFamily);
    if (!logicalFamily) continue;
    const dedupeKey = normalizeToolbarFamily(logicalFamily);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    merged.push({
      label: logicalFamily,
      key: logicalFamily,
      props: {
        style: { fontFamily: option.previewFamily || logicalFamily },
        'data-item': 'btn-fontFamily-option',
      },
    });
  }
  return merged.length > TOOLBAR_FONTS.length ? merged.sort(compareToolbarFontOptions) : undefined;
}

export function mapFontFamilyOptionsToToolbar(
  options: readonly FontFamilyOption[] | null | undefined,
): ToolbarFontOption[] | undefined {
  if (!options?.length) return undefined;
  return options.map((option) => ({
    label: option.label,
    key: option.value,
    props: {
      style: { fontFamily: option.previewFamily || option.label },
      'data-item': 'btn-fontFamily-option',
    },
  }));
}

export const TOOLBAR_FONT_SIZES = [
  { label: '8', key: '8pt', props: { 'data-item': 'btn-fontSize-option' } },
  { label: '9', key: '9pt', props: { 'data-item': 'btn-fontSize-option' } },
  { label: '10', key: '10pt', props: { 'data-item': 'btn-fontSize-option' } },
  { label: '11', key: '11pt', props: { 'data-item': 'btn-fontSize-option' } },
  { label: '12', key: '12pt', props: { 'data-item': 'btn-fontSize-option' } },
  { label: '14', key: '14pt', props: { 'data-item': 'btn-fontSize-option' } },
  { label: '18', key: '18pt', props: { 'data-item': 'btn-fontSize-option' } },
  { label: '24', key: '24pt', props: { 'data-item': 'btn-fontSize-option' } },
  { label: '30', key: '30pt', props: { 'data-item': 'btn-fontSize-option' } },
  { label: '36', key: '36pt', props: { 'data-item': 'btn-fontSize-option' } },
  { label: '48', key: '48pt', props: { 'data-item': 'btn-fontSize-option' } },
  { label: '60', key: '60pt', props: { 'data-item': 'btn-fontSize-option' } },
  { label: '72', key: '72pt', props: { 'data-item': 'btn-fontSize-option' } },
  { label: '96', key: '96pt', props: { 'data-item': 'btn-fontSize-option' } },
];

export const RESPONSIVE_BREAKPOINTS = {
  sm: 768,
  md: 1024,
  lg: 1280,
  xl: 1410,
};
