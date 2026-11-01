/**
 * Pure typeahead/autocomplete helpers for the font comboboxes (family + size).
 *
 * Matching is case-insensitive prefix matching on the logical font labels.
 * Space is a normal query character, so the query is never split on spaces;
 * only the outer whitespace is ignored when comparing.
 *
 * These functions hold no Vue or DOM state so CI can unit-test them in isolation.
 */

interface TypeaheadResult {
  matchIndex: number;
  display: string;
  selectionStart: number;
  selectionEnd: number;
}

const normalize = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toLowerCase();

/**
 * Index of the first label that starts with `query` (case-insensitive).
 * An empty/whitespace query never matches. Returns the matching index or -1.
 */
export const findPrefixMatchIndex = (query: string, labels: ReadonlyArray<string>): number => {
  const q = normalize(query);
  if (!q) return -1;
  for (let i = 0; i < labels.length; i += 1) {
    if (normalize(labels[i]).startsWith(q)) return i;
  }
  return -1;
};

/**
 * Resolve what the input should display after a keystroke.
 *
 * When `autocomplete` is true and a prefix match exists that is longer than the
 * typed query, the completion is shown with the suffix selected so the next
 * keystroke replaces it. When false (deletion) or no match exists, the raw
 * query is shown with the caret at its end. `query` is the user-typed portion.
 */
export const computeTypeahead = (
  query: string,
  labels: ReadonlyArray<string>,
  { autocomplete = true }: { autocomplete?: boolean } = {},
): TypeaheadResult => {
  const typed = String(query ?? '');
  const matchIndex = findPrefixMatchIndex(typed, labels);
  const completion = matchIndex >= 0 ? String(labels[matchIndex] ?? '') : '';

  if (autocomplete && matchIndex >= 0 && completion.length > typed.length) {
    return {
      matchIndex,
      display: completion,
      selectionStart: typed.length,
      selectionEnd: completion.length,
    };
  }

  return {
    matchIndex,
    display: typed,
    selectionStart: typed.length,
    selectionEnd: typed.length,
  };
};

const stripWrappingQuotes = (value: unknown): string => {
  let result = String(value ?? '').trim();
  while (
    result.length >= 2 &&
    ((result.startsWith('"') && result.endsWith('"')) || (result.startsWith("'") && result.endsWith("'")))
  ) {
    result = result.slice(1, -1).trim();
  }
  return result;
};

// C0 control characters (0x00-0x1F) and DEL (0x7F). These never belong in a
// logical font family name, so they are stripped before any other normalization.
const isControlChar = (charCode: number): boolean => charCode <= 0x1f || charCode === 0x7f;

// The whitespace set CSS treats as collapsible inside a family name once control
// characters are gone: ASCII space, no-break space, and the zero-width BOM.
const isCollapsibleSpace = (charCode: number): boolean => charCode === 0x20 || charCode === 0xa0 || charCode === 0xfeff;

const stripControlChars = (value: string): string =>
  Array.from(String(value))
    .filter((char) => !isControlChar(char.charCodeAt(0)))
    .join('');

const collapseWhitespace = (value: string): string => {
  let result = '';
  let pendingSpace = false;
  for (const char of String(value)) {
    if (isCollapsibleSpace(char.charCodeAt(0))) {
      pendingSpace = result.length > 0;
      continue;
    }
    if (pendingSpace) result += ' ';
    pendingSpace = false;
    result += char;
  }
  return result;
};

export const normalizeCustomFontFamily = (value: unknown): string => {
  const firstFamily = String(value ?? '').split(',')[0] ?? '';
  const withoutControls = stripControlChars(firstFamily);
  return collapseWhitespace(stripWrappingQuotes(withoutControls)).trim();
};

// Word allows point sizes from 1 to 1638. Sizes below the minimum are rejected
// (no command) and anything larger is clamped, so a stray keystroke cannot emit
// an absurd value. The toolbar's preset list and the active-state display
// (default-items.ts `fontSize.onActivate`) narrow the visible set further.
const MIN_FONT_SIZE = 1;
const MAX_FONT_SIZE = 1638;

/**
 * Normalize a typed font size to a supported point-size string.
 * Parses the numeric value (ignoring any unit suffix) keeping its sign, rounds to
 * the nearest half point (DOCX/Word support half points such as 10.5), and clamps
 * to the supported range. Returns '' when nothing usable was typed, including
 * negative or sub-minimum values.
 */
export const normalizeCustomFontSize = (value: unknown): string => {
  // Keep the sign: stripping '-' would turn a typed negative into a positive size and apply it.
  const cleaned = String(value ?? '').replace(/[^0-9.-]/g, '');
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) return '';
  const halfPoint = Math.round(parsed * 2) / 2;
  if (halfPoint < MIN_FONT_SIZE) return '';
  return String(Math.min(halfPoint, MAX_FONT_SIZE));
};
