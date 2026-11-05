import { SuperDocClient } from '@superdoc/sdk';

const token = process.env.OBSERVER_TOKEN;
if (!token) throw new Error('Set OBSERVER_TOKEN to a token your collaboration server accepts.');

const client = new SuperDocClient();

try {
  await client.connect();
  const doc = await client.open(
    {
      collaboration: {
        providerType: 'hocuspocus',
        url: process.env.COLLAB_URL ?? 'ws://127.0.0.1:1234',
        documentId: process.env.DOCUMENT_ID ?? 'contract-123',
        roomMode: 'join',
      },
    },
    { collaborationAuth: { type: 'token', token } },
  );

  try {
    let cursor: string | null = null;
    for (let polls = 0; polls < 10; polls++) {
      const result = await doc.changes.list({ ...(cursor ? { after: cursor } : {}), waitMs: 30_000 });
      for (const record of result.items) {
        const who = record.actor?.id ?? 'unknown';
        const when = record.at.declared ?? record.at.observed;
        console.log(`${when} ${who} ${record.changes.map((change) => change.kind).join(', ')}`);
      }
      cursor = result.cursor;
    }
  } finally {
    await doc.close({ discard: true });
  }
} finally {
  await client.dispose();
}
