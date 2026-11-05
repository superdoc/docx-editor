import { describe, expect, it, mock } from 'bun:test';
import {
  SUPERDOC_TABLE_PRESET_IDS,
  TABLE_PRESET_CATALOGUE,
  TABLE_PRESET_IDS,
  TABLE_PRESET_LIST_MAX_LIMIT,
  WORD_TABLE_PRESETS,
  getWordTablePreset,
  isTablePresetId,
  listTablePresets,
} from './table-style-presets.js';
import { executeTablesApplyPreset, executeTablesListPresets } from './tables.js';
import { DocumentApiValidationError } from '../errors.js';
import { OPERATION_DEFINITIONS } from '../contract/operation-definitions.js';
import { buildInternalContractSchemas } from '../contract/schemas.js';

describe('table preset catalogue', () => {
  it('contains 105 unique Word presets in 7 plain, 49 grid, and 49 list groups', () => {
    expect(WORD_TABLE_PRESETS).toHaveLength(105);
    const groups = { plain: 0, grid: 0, list: 0, convenience: 0 };
    for (const preset of WORD_TABLE_PRESETS) groups[preset.group] += 1;
    expect(groups).toEqual({ plain: 7, grid: 49, list: 49, convenience: 0 });
    for (const field of ['id', 'name', 'wordStyleName', 'wordStyleId'] as const) {
      expect(new Set(WORD_TABLE_PRESETS.map((preset) => preset[field])).size).toBe(105);
    }
  });

  it('keeps the four SuperDoc presets distinct from Word presets', () => {
    expect(SUPERDOC_TABLE_PRESET_IDS).toEqual(['grid', 'minimal', 'striped', 'accent']);
    expect(TABLE_PRESET_CATALOGUE).toHaveLength(109);
    expect(new Set(TABLE_PRESET_IDS).size).toBe(109);
    for (const id of SUPERDOC_TABLE_PRESET_IDS) {
      expect(getWordTablePreset(id)).toBeNull();
      expect(isTablePresetId(id)).toBe(true);
    }
  });

  it('maps preset IDs, Word style names, and DOCX style IDs explicitly', () => {
    expect(getWordTablePreset('word.grid-table-light')).toMatchObject({
      name: 'Table Grid Light',
      wordStyleName: 'Grid Table Light',
      wordStyleId: 'TableGridLight',
      group: 'plain',
      accent: null,
    });
    expect(getWordTablePreset('word.grid-table-4-accent-1')).toMatchObject({
      wordStyleName: 'Grid Table 4 Accent 1',
      wordStyleId: 'GridTable4-Accent1',
      group: 'grid',
      accent: 1,
    });
    expect(getWordTablePreset('word.list-table-1-light-accent-6')).toMatchObject({
      wordStyleName: 'List Table 1 Light Accent 6',
      wordStyleId: 'ListTable1Light-Accent6',
      group: 'list',
      accent: 6,
    });
    expect(getWordTablePreset('word.table-grid')?.wordStyleId).toBe('TableGrid');
  });

  it('has seven variants for every design and family', () => {
    for (const family of ['grid-table', 'list-table']) {
      for (const design of ['1-light', '2', '3', '4', '5-dark', '6-colorful', '7-colorful']) {
        const variants = WORD_TABLE_PRESETS.filter(
          (preset) =>
            preset.id === `word.${family}-${design}` || preset.id.startsWith(`word.${family}-${design}-accent-`),
        );
        expect(variants.map((preset) => preset.accent)).toEqual([null, 1, 2, 3, 4, 5, 6]);
      }
    }
  });
});

describe('listTablePresets', () => {
  it('returns all seven Grid Table 4 variants on the first page', () => {
    const page = listTablePresets({ source: 'word', group: 'grid', query: 'Grid Table 4', limit: 25, offset: 0 });
    expect(page.total).toBe(7);
    expect(page.nextOffset).toBeNull();
    expect(page.items.map((item) => item.id)).toEqual([
      'word.grid-table-4',
      'word.grid-table-4-accent-1',
      'word.grid-table-4-accent-2',
      'word.grid-table-4-accent-3',
      'word.grid-table-4-accent-4',
      'word.grid-table-4-accent-5',
      'word.grid-table-4-accent-6',
    ]);
    expect(Object.keys(page.items[1]!).sort()).toEqual(['accent', 'group', 'id', 'name', 'source']);
  });

  it('paginates every entry once with stable ordering', () => {
    for (const source of [undefined, 'word', 'superdoc'] as const) {
      const seen: string[] = [];
      let offset: number | null = 0;
      let total = -1;
      while (offset !== null) {
        const page = listTablePresets({ source, limit: TABLE_PRESET_LIST_MAX_LIMIT, offset });
        total = page.total;
        expect(page.offset).toBe(offset);
        seen.push(...page.items.map((item) => item.id));
        offset = page.nextOffset;
      }
      const expected = TABLE_PRESET_CATALOGUE.filter((preset) => source === undefined || preset.source === source);
      expect(total).toBe(expected.length);
      expect(seen).toEqual(expected.map((preset) => preset.id));
    }
  });

  it('normalizes hyphens, dashes, and spaces in queries', () => {
    for (const query of ['grid-table-4-accent-1', 'Grid Table 4 - Accent 1', 'grid table 4 – accent 1']) {
      expect(listTablePresets({ query }).items.map((item) => item.id)).toEqual(['word.grid-table-4-accent-1']);
    }
    expect(listTablePresets({ source: 'superdoc', group: 'convenience' }).items.map((item) => item.id)).toEqual([
      'grid',
      'minimal',
      'striped',
      'accent',
    ]);
  });

  it('keeps every maximum-size page under the full tool result limit', () => {
    for (let offset = 0; offset < TABLE_PRESET_CATALOGUE.length; offset += TABLE_PRESET_LIST_MAX_LIMIT) {
      const page = listTablePresets({ limit: TABLE_PRESET_LIST_MAX_LIMIT, offset });
      expect(JSON.stringify(page, null, 2).length).toBeLessThan(8000);
    }
  });

  it('rejects invalid input before listing', () => {
    for (const input of [
      { limit: 0 },
      { limit: 26 },
      { limit: 2.5 },
      { offset: -1 },
      { source: 'office' },
      { group: 'custom' },
      { query: 4 },
      { unknown: true },
    ]) {
      expect(() => executeTablesListPresets(input as never)).toThrow(DocumentApiValidationError);
    }
    expect(executeTablesListPresets(undefined).total).toBe(109);
  });

  it('agrees with the operation schema', () => {
    const schema = buildInternalContractSchemas().operations['tables.listPresets'];
    expect(schema.input.properties.limit.maximum).toBe(TABLE_PRESET_LIST_MAX_LIMIT);
    expect(OPERATION_DEFINITIONS['tables.listPresets'].metadata.mutates).toBe(false);
    const applySchema = buildInternalContractSchemas().operations['tables.applyPreset'];
    expect(applySchema.input.properties.preset.enum).toEqual([...TABLE_PRESET_IDS]);
  });
});

describe('executeTablesApplyPreset', () => {
  const adapter = mock(() => ({ success: true }));

  it('forwards Word presets with style options', () => {
    adapter.mockClear();
    executeTablesApplyPreset(adapter, {
      nodeId: 'table-1',
      preset: 'word.grid-table-4-accent-1',
      styleOptions: { headerRow: true, bandedRows: false },
    });
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown presets, accent colors on Word presets, and invalid flags', () => {
    adapter.mockClear();
    for (const input of [
      { nodeId: 'table-1', preset: 'word.grid-table-8' },
      { nodeId: 'table-1', preset: 'word.grid-table-4-accent-1', accentColor: 'FF0000' },
      { nodeId: 'table-1', preset: 'striped', styleOptions: { zebra: true } },
      { nodeId: 'table-1', preset: 'striped', styleOptions: { headerRow: 'yes' } },
      { preset: 'striped' },
    ]) {
      expect(() => executeTablesApplyPreset(adapter, input as never)).toThrow(DocumentApiValidationError);
    }
    expect(adapter).not.toHaveBeenCalled();
  });

  it('keeps accentColor for the SuperDoc accent preset', () => {
    adapter.mockClear();
    executeTablesApplyPreset(adapter, { nodeId: 'table-1', preset: 'accent', accentColor: '2F5496' });
    expect(adapter).toHaveBeenCalledTimes(1);
  });
});
