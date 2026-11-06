import { SuperDocClient } from '@superdoc/sdk';

const client = new SuperDocClient();

try {
  await client.connect();
  const doc = await client.open({ doc: './pricing.docx' });

  try {
    const { blocks } = await doc.blocks.list({ nodeTypes: ['table'] });
    const table = blocks[0];
    if (!table) throw new Error('pricing.docx has no table.');

    const page = await doc.tables.listPresets({ source: 'word', query: 'Grid Table 4' });
    console.log(page.items.map((preset) => `${preset.id}  ${preset.name}`));

    await doc.tables.applyPreset({
      nodeId: table.nodeId,
      preset: 'word.grid-table-4-accent-1',
      styleOptions: { headerRow: true, bandedRows: true, firstColumn: false },
    });

    const { styleId } = await doc.tables.getProperties({ nodeId: table.nodeId });
    console.log('Table style:', styleId);

    await doc.save({ out: './pricing.styled.docx', force: true });
  } finally {
    await doc.close({ discard: true });
  }
} finally {
  await client.dispose();
}
