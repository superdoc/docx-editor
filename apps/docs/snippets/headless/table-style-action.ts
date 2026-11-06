import { createAgentToolkit, defineAction, type BoundDocApi } from '@superdoc/sdk';

type PresetId = Parameters<BoundDocApi['tables']['applyPreset']>[0]['preset'];

const isListedPreset = (id: string, listed: ReadonlyArray<{ id: string }>): id is PresetId =>
  listed.some((item) => item.id === id);

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const applyTableStyle = defineAction({
  name: 'superdoc.apply_table_style',
  description:
    'Apply a built-in Word table style to a table. Name the style as Word does, for example "Table Grid", ' +
    '"Plain Table 2", "List Table 3", or "Grid Table 4 - Accent 1". Accent 1-6 follow the document theme colors.',
  input: {
    type: 'object',
    properties: {
      style: { type: 'string', description: 'Word table style name or preset id.' },
      tableOrdinal: { type: 'number', description: '1-based table number. Defaults to 1.' },
      headerRow: { type: 'boolean', description: 'Format the first row as a header. Defaults to true.' },
      bandedRows: { type: 'boolean', description: 'Alternate row formatting. Defaults to true.' },
      firstColumn: { type: 'boolean', description: 'Emphasize the first column. Defaults to false.' },
    },
    required: ['style'],
  },
  run: async (doc, args) => {
    const ordinal = typeof args.tableOrdinal === 'number' ? args.tableOrdinal : 1;
    const { blocks } = await doc.blocks.list({ nodeTypes: ['table'] });
    const table = blocks[ordinal - 1];
    if (!table) throw new Error(`Table ${ordinal} does not exist. The document has ${blocks.length}.`);

    const wanted = normalize(String(args.style));
    const { items } = await doc.tables.listPresets({ source: 'word', query: String(args.style) });
    const preset = items.find((item) => normalize(item.id) === wanted || normalize(item.name) === wanted);
    if (!preset || !isListedPreset(preset.id, items)) {
      const names = items.map((item) => item.name).join(', ');
      throw new Error(`No Word table style is named "${args.style}". Close matches: ${names || 'none'}.`);
    }

    await doc.tables.applyPreset({
      nodeId: table.nodeId,
      preset: preset.id,
      styleOptions: {
        headerRow: args.headerRow !== false,
        bandedRows: args.bandedRows !== false,
        firstColumn: args.firstColumn === true,
      },
    });
    return { tableOrdinal: ordinal, style: preset.name };
  },
});

export const toolkit = await createAgentToolkit({
  provider: 'openai',
  preset: 'core',
  customActions: [applyTableStyle],
});
