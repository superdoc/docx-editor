/**
 * Built-in toolbar font dropdown defaults.
 *
 * The v1 toolbar derived these from `@superdoc/font-system`'s offering registry.
 * On the V2 `superdoc` package that registry is NOT importable from the published
 * ES build (it is aliased only for the dev/CDN/test builds), so this module must
 * stay free of any `@superdoc/font-system` value import. The activation-aware family
 * list is computed host-side and surfaced through `superdoc.fonts.getFontFamilyOptions()`;
 * {@link mapFontFamilyOptionsToToolbar} turns it into toolbar options. The static
 * {@link TOOLBAR_FONTS} below is the fallback used only when no font runtime is yet
 * available (e.g. before an editor mounts).
 *
 * Per the toolbar font option shape: `label` is the Word-facing logical family
 * (stored on the selection + used for active-state matching; the dropdown emits
 * the label), `key` is a stable option key, and `props.style.fontFamily` is the
 * preview stack the row renders in.
 */
const DEFAULT_TOOLBAR_FONT_FAMILIES = [
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

export const TOOLBAR_FONTS = DEFAULT_TOOLBAR_FONT_FAMILIES.map(([family, generic]) => ({
  label: family,
  key: family,
  props: {
    style: { fontFamily: `${family}, ${generic}` },
    'data-item': 'btn-fontFamily-option',
  },
}));

function normalizeToolbarFamily(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function firstToolbarFamilyToken(value) {
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

function compareToolbarFontOptions(a, b) {
  return String(a.label ?? '')
    .trim()
    .localeCompare(String(b.label ?? '').trim(), 'en', { sensitivity: 'base' });
}

/**
 * The single seam that composes the font dropdown options: it turns the active document's
 * {@link import('@superdoc/font-system').DocumentFontOption}s into toolbar font options and unions them
 * with the bundled defaults. The toolbar only asks for the result; it does not know how a font previews.
 *
 * - A consumer-provided `configFonts` list is returned UNCHANGED (custom toolbars own their list).
 * - With no document options, returns `undefined` so the caller keeps its fallback to {@link TOOLBAR_FONTS}.
 * - Otherwise: bundled defaults and document fonts are deduped by normalized logical family, then sorted
 *   alphabetically by the visible font name. `label`/`key` stay the pure logical family (active-state
 *   matching + the stored value), and the preview renders in `previewFamily`.
 *
 * @param {ReadonlyArray<import('@superdoc/font-system').DocumentFontOption>} documentOptions
 * @param {Array} [configFonts] - the consumer's `fonts` config, if any
 * @returns {Array|undefined}
 */
export function composeToolbarFontOptions(documentOptions, configFonts) {
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

/**
 * Map the host-computed, activation-aware font-family options onto the toolbar option shape. PURE: it
 * receives the already-resolved list from `superdoc.fonts.getFontFamilyOptions()` (the host owns the
 * `@superdoc/font-system` computation this module must not import). Returns `undefined` for an empty
 * list so the caller keeps its {@link TOOLBAR_FONTS} fallback. `label` is the Word-facing logical
 * family (stored on the selection + used for active-state matching), `key` is a stable option key, and
 * the row preview renders in `previewFamily` (falling back to the label).
 *
 * @param {ReadonlyArray<import('@superdoc/font-system').FontFamilyOption>} options
 * @returns {Array|undefined}
 */
export function mapFontFamilyOptionsToToolbar(options) {
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

export const HEADLESS_ITEM_MAP = {
  undo: 'undo',
  redo: 'redo',
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strike: 'strikethrough',
  acceptTrackedChangeBySelection: 'track-changes-accept-selection',
  rejectTrackedChangeOnSelection: 'track-changes-reject-selection',
  ruler: 'ruler',
  formattingMarks: 'formatting-marks',
  zoom: 'zoom',
  measurementUnit: 'measurement-unit',
  documentMode: 'document-mode',
  link: 'link',
  fontFamily: 'font-family',
  fontSize: 'font-size',
  list: 'bullet-list',
  numberedlist: 'numbered-list',
  table: 'table-insert',
  image: 'image',
  tableOfContents: 'table-of-contents-insert',
  color: 'text-color',
  highlight: 'highlight-color',
  textAlign: 'text-align',
  lineHeight: 'line-height',
  linkedStyles: 'linked-style',
  indentleft: 'indent-decrease',
  indentright: 'indent-increase',
  directionLtr: 'direction-ltr',
  directionRtl: 'direction-rtl',
  clearFormatting: 'clear-formatting',
  copyFormat: 'copy-format',
};

export const TABLE_ACTION_COMMAND_MAP = {
  addRowBefore: 'table-add-row-before',
  addRowAfter: 'table-add-row-after',
  deleteRow: 'table-delete-row',
  addColumnBefore: 'table-add-column-before',
  addColumnAfter: 'table-add-column-after',
  deleteColumn: 'table-delete-column',
  deleteTable: 'table-delete',
  deleteCellAndTableBorders: 'table-remove-borders',
  mergeCells: 'table-merge-cells',
  splitCell: 'table-split-cell',
  fixTables: 'table-fix',
};

export const TABLE_ACTION_COMMAND_IDS = Object.values(TABLE_ACTION_COMMAND_MAP);
