export type TablePresetSource = 'word' | 'superdoc';
export type TablePresetGroup = 'plain' | 'grid' | 'list' | 'convenience';
export type TablePresetAccent = 1 | 2 | 3 | 4 | 5 | 6;

export type SuperDocTablePresetId = 'grid' | 'minimal' | 'striped' | 'accent';

type WordDesignNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;
type WordDesignSlug = `${WordDesignNumber}` | '1-light' | '5-dark' | '6-colorful' | '7-colorful';
type WordFamilySlug = 'grid-table' | 'list-table';
type WordDesignedPresetId =
  | `word.${WordFamilySlug}-${'1-light' | '2' | '3' | '4' | '5-dark' | '6-colorful' | '7-colorful'}`
  | `word.${WordFamilySlug}-${'1-light' | '2' | '3' | '4' | '5-dark' | '6-colorful' | '7-colorful'}-accent-${TablePresetAccent}`;

export type WordPlainTablePresetId =
  | 'word.table-grid'
  | 'word.grid-table-light'
  | `word.plain-table-${1 | 2 | 3 | 4 | 5}`;

export type WordTablePresetId = WordPlainTablePresetId | WordDesignedPresetId;

export type TablePresetId = SuperDocTablePresetId | WordTablePresetId;

export interface TablePresetInfo {
  id: TablePresetId;
  name: string;
  source: TablePresetSource;
  group: TablePresetGroup;
  accent: TablePresetAccent | null;
}

export interface WordTablePresetDefinition extends TablePresetInfo {
  id: WordTablePresetId;
  source: 'word';
  wordStyleName: string;
  wordStyleId: string;
}

export const SUPERDOC_TABLE_PRESET_IDS = [
  'grid',
  'minimal',
  'striped',
  'accent',
] as const satisfies readonly SuperDocTablePresetId[];

const SUPERDOC_PRESET_NAMES: Record<SuperDocTablePresetId, string> = {
  grid: 'SuperDoc Grid',
  minimal: 'SuperDoc Minimal',
  striped: 'SuperDoc Striped',
  accent: 'SuperDoc Accent',
};

const WORD_PLAIN_STYLES: ReadonlyArray<{
  id: WordPlainTablePresetId;
  wordStyleName: string;
  wordStyleId: string;
  name?: string;
}> = [
  { id: 'word.table-grid', wordStyleName: 'Table Grid', wordStyleId: 'TableGrid' },
  {
    id: 'word.grid-table-light',
    wordStyleName: 'Grid Table Light',
    wordStyleId: 'TableGridLight',
    name: 'Table Grid Light',
  },
  { id: 'word.plain-table-1', wordStyleName: 'Plain Table 1', wordStyleId: 'PlainTable1' },
  { id: 'word.plain-table-2', wordStyleName: 'Plain Table 2', wordStyleId: 'PlainTable2' },
  { id: 'word.plain-table-3', wordStyleName: 'Plain Table 3', wordStyleId: 'PlainTable3' },
  { id: 'word.plain-table-4', wordStyleName: 'Plain Table 4', wordStyleId: 'PlainTable4' },
  { id: 'word.plain-table-5', wordStyleName: 'Plain Table 5', wordStyleId: 'PlainTable5' },
];

const WORD_DESIGNS = [
  { number: 1, qualifier: 'Light', slug: '1-light' },
  { number: 2, qualifier: '', slug: '2' },
  { number: 3, qualifier: '', slug: '3' },
  { number: 4, qualifier: '', slug: '4' },
  { number: 5, qualifier: 'Dark', slug: '5-dark' },
  { number: 6, qualifier: 'Colorful', slug: '6-colorful' },
  { number: 7, qualifier: 'Colorful', slug: '7-colorful' },
] as const satisfies ReadonlyArray<{ number: WordDesignNumber; qualifier: string; slug: WordDesignSlug }>;

const WORD_FAMILIES = [
  { group: 'grid', label: 'Grid Table', slug: 'grid-table', idStem: 'GridTable' },
  { group: 'list', label: 'List Table', slug: 'list-table', idStem: 'ListTable' },
] as const;

const WORD_ACCENTS = [1, 2, 3, 4, 5, 6] as const satisfies readonly TablePresetAccent[];

export const WORD_ACCENT_DISPLAY_SEPARATOR = ' - ';

function buildDesignedWordPresets(): WordTablePresetDefinition[] {
  const presets: WordTablePresetDefinition[] = [];
  for (const family of WORD_FAMILIES) {
    for (const design of WORD_DESIGNS) {
      const baseName = [family.label, String(design.number), design.qualifier].filter(Boolean).join(' ');
      const baseStyleId = `${family.idStem}${design.number}${design.qualifier}`;
      presets.push({
        id: `word.${family.slug}-${design.slug}` as const,
        name: baseName,
        source: 'word',
        group: family.group,
        accent: null,
        wordStyleName: baseName,
        wordStyleId: baseStyleId,
      });
      for (const accent of WORD_ACCENTS) {
        presets.push({
          id: `word.${family.slug}-${design.slug}-accent-${accent}` as const,
          name: `${baseName}${WORD_ACCENT_DISPLAY_SEPARATOR}Accent ${accent}`,
          source: 'word',
          group: family.group,
          accent,
          wordStyleName: `${baseName} Accent ${accent}`,
          wordStyleId: `${baseStyleId}-Accent${accent}`,
        });
      }
    }
  }
  return presets;
}

export const WORD_TABLE_PRESETS: readonly WordTablePresetDefinition[] = Object.freeze([
  ...WORD_PLAIN_STYLES.map(
    (style): WordTablePresetDefinition => ({
      id: style.id,
      name: style.name ?? style.wordStyleName,
      source: 'word',
      group: 'plain',
      accent: null,
      wordStyleName: style.wordStyleName,
      wordStyleId: style.wordStyleId,
    }),
  ),
  ...buildDesignedWordPresets(),
]);

export const SUPERDOC_TABLE_PRESETS: readonly TablePresetInfo[] = Object.freeze(
  SUPERDOC_TABLE_PRESET_IDS.map(
    (id): TablePresetInfo => ({
      id,
      name: SUPERDOC_PRESET_NAMES[id],
      source: 'superdoc',
      group: 'convenience',
      accent: null,
    }),
  ),
);

export const TABLE_PRESET_CATALOGUE: readonly TablePresetInfo[] = Object.freeze([
  ...WORD_TABLE_PRESETS.map(
    ({ id, name, source, group, accent }): TablePresetInfo => ({ id, name, source, group, accent }),
  ),
  ...SUPERDOC_TABLE_PRESETS,
]);

export const TABLE_PRESET_IDS: readonly TablePresetId[] = Object.freeze(
  TABLE_PRESET_CATALOGUE.map((preset) => preset.id),
);

const WORD_PRESET_BY_ID: ReadonlyMap<string, WordTablePresetDefinition> = new Map(
  WORD_TABLE_PRESETS.map((preset) => [preset.id, preset]),
);

export function isWordTablePresetId(value: unknown): value is WordTablePresetId {
  return typeof value === 'string' && WORD_PRESET_BY_ID.has(value);
}

export function isSuperDocTablePresetId(value: unknown): value is SuperDocTablePresetId {
  return SUPERDOC_TABLE_PRESET_IDS.some((id) => id === value);
}

export function isTablePresetId(value: unknown): value is TablePresetId {
  return isWordTablePresetId(value) || isSuperDocTablePresetId(value);
}

export function getWordTablePreset(id: string): WordTablePresetDefinition | null {
  return WORD_PRESET_BY_ID.get(id) ?? null;
}

export const TABLE_PRESET_LIST_DEFAULT_LIMIT = 25;
export const TABLE_PRESET_LIST_MAX_LIMIT = 25;

export interface TablesListPresetsInput {
  source?: TablePresetSource;
  group?: TablePresetGroup;
  query?: string;
  limit?: number;
  offset?: number;
}

export interface TablesListPresetsOutput {
  items: TablePresetInfo[];
  total: number;
  offset: number;
  nextOffset: number | null;
}

function normalizePresetSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‐-―]/g, '-')
    .replace(/[\s_.-]+/g, ' ')
    .trim();
}

export function listTablePresets(input: TablesListPresetsInput = {}): TablesListPresetsOutput {
  const limit = input.limit ?? TABLE_PRESET_LIST_DEFAULT_LIMIT;
  const offset = input.offset ?? 0;
  const query = input.query === undefined ? '' : normalizePresetSearchText(input.query);
  const matches = TABLE_PRESET_CATALOGUE.filter((preset) => {
    if (input.source !== undefined && preset.source !== input.source) return false;
    if (input.group !== undefined && preset.group !== input.group) return false;
    if (!query) return true;
    return (
      normalizePresetSearchText(preset.id).includes(query) || normalizePresetSearchText(preset.name).includes(query)
    );
  });
  const items = matches.slice(offset, offset + limit).map((preset) => ({ ...preset }));
  const end = offset + items.length;
  return { items, total: matches.length, offset, nextOffset: end < matches.length ? end : null };
}
