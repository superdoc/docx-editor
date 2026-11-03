import type { FontFamilyOption, FontSizeOption } from './types.js';
import { isObjectRecord } from '../../helpers/object-guards.js';

export const DEFAULT_FONT_FAMILY_OPTIONS: readonly FontFamilyOption[] = [
  { value: 'Arial', label: 'Arial', previewFamily: 'Arial, sans-serif' },
  { value: 'Calibri', label: 'Calibri', previewFamily: 'Calibri, sans-serif' },
  { value: 'Courier New', label: 'Courier New', previewFamily: '"Courier New", monospace' },
  { value: 'Georgia', label: 'Georgia', previewFamily: 'Georgia, serif' },
  { value: 'Times New Roman', label: 'Times New Roman', previewFamily: '"Times New Roman", serif' },
  { value: 'Verdana', label: 'Verdana', previewFamily: 'Verdana, sans-serif' },
];

export function canonicalFontFamilyName(family: string): string {
  const trimmed = family.trim();
  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    const close = trimmed.indexOf(quote, 1);
    if (close > 0) return trimmed.slice(1, close).trim();
  }
  const comma = trimmed.indexOf(',');
  const first = comma === -1 ? trimmed : trimmed.slice(0, comma);
  return first.trim().replace(/^["']|["']$/g, '');
}

export function normalizeDocumentFontOptions(raw: unknown): FontFamilyOption[] {
  if (!Array.isArray(raw)) return [];
  const out: FontFamilyOption[] = [];
  for (const option of raw) {
    if (!isObjectRecord(option)) continue;
    const rec = option;
    const logical = typeof rec.logicalFamily === 'string' ? canonicalFontFamilyName(rec.logicalFamily) : '';
    if (!logical) continue;
    const previewFamily =
      typeof rec.previewFamily === 'string' && rec.previewFamily.trim() ? rec.previewFamily.trim() : logical;
    out.push({ value: logical, label: logical, previewFamily });
  }
  return out;
}

export function normalizePickerFontOptions(raw: unknown): FontFamilyOption[] {
  if (!Array.isArray(raw)) return [];
  const out: FontFamilyOption[] = [];
  for (const option of raw) {
    if (!isObjectRecord(option)) continue;
    const rec = option;
    const value = typeof rec.value === 'string' ? rec.value.trim() : '';
    if (!value) continue;
    const label = typeof rec.label === 'string' && rec.label.trim() ? rec.label.trim() : value;
    const previewFamily =
      typeof rec.previewFamily === 'string' && rec.previewFamily.trim() ? rec.previewFamily.trim() : value;
    out.push({ value, label, previewFamily });
  }
  return out;
}

export function composeFontFamilyOptions(
  documentOptions: readonly FontFamilyOption[],
  pickerOptions: readonly FontFamilyOption[] = [],
): FontFamilyOption[] {
  const out: FontFamilyOption[] = [];
  const seen = new Set<string>();
  const push = (option: FontFamilyOption): void => {
    const key = String(option.value).trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(option);
  };
  for (const option of documentOptions) push(option);
  const defaults = pickerOptions.length ? pickerOptions : DEFAULT_FONT_FAMILY_OPTIONS;
  for (const option of defaults) push(option);
  return out;
}

export const DEFAULT_FONT_SIZE_OPTIONS: readonly FontSizeOption[] = [
  { value: '8', label: '8' },
  { value: '9', label: '9' },
  { value: '10', label: '10' },
  { value: '11', label: '11' },
  { value: '12', label: '12' },
  { value: '14', label: '14' },
  { value: '16', label: '16' },
  { value: '18', label: '18' },
  { value: '24', label: '24' },
  { value: '36', label: '36' },
];
