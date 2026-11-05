import { SuperDocCliError, SuperDocClient } from '@superdoc/sdk';

const token = process.env.OBSERVER_TOKEN;
if (!token) throw new Error('Set OBSERVER_TOKEN to a read-only token for the room.');

const client = new SuperDocClient();
const notifications = client.subscribe({ capacity: 256 });

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
    for (;;) {
      const result = await doc.changes.list({ ...(cursor ? { after: cursor } : {}), includeUpdate: true });
      for (const record of result.items) console.log(record.id, record.actor?.id ?? 'unknown');
      cursor = result.cursor;
      if (result.items.length > 0) continue;

      try {
        const next = await notifications.next();
        if (next.done) break;
      } catch (error) {
        if (error instanceof SuperDocCliError && error.code === 'NOTIFICATIONS_LAGGED') continue;
        throw error;
      }
    }
  } finally {
    await doc.close({ discard: true });
  }
} finally {
  notifications.close();
  await client.dispose();
}
