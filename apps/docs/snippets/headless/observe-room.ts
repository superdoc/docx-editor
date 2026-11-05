import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SuperDocClient } from '@superdoc/sdk';

const SNAPSHOT_EVERY_RECORDS = 250;
const SNAPSHOT_EVERY_MS = 10 * 60 * 1000;

const documentId = process.env.DOCUMENT_ID ?? 'contract-123';
const token = process.env.OBSERVER_TOKEN;
if (!token) throw new Error('Set OBSERVER_TOKEN to a read-only token for the room.');

const historyDir = join('history', documentId);
const recordsFile = join(historyDir, 'records.jsonl');
const cursorFile = join(historyDir, 'cursor.txt');
mkdirSync(join(historyDir, 'snapshots'), { recursive: true });

const storedIds = new Set<string>(
  existsSync(recordsFile)
    ? readFileSync(recordsFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line).id)
    : [],
);
let cursor = existsSync(cursorFile) ? readFileSync(cursorFile, 'utf8') : '';

let stopping = false;
process.once('SIGINT', () => {
  stopping = true;
});

const client = new SuperDocClient();

try {
  await client.connect();
  const doc = await client.open(
    {
      collaboration: {
        providerType: 'hocuspocus',
        url: process.env.COLLAB_URL ?? 'ws://127.0.0.1:1234',
        documentId,
        roomMode: 'join',
      },
    },
    { collaborationAuth: { type: 'token', token } },
  );

  const saveSnapshot = async () => {
    const snapshot = await doc.changes.snapshot({ includeState: true });
    const file = join(historyDir, 'snapshots', `${snapshot.at.replaceAll(':', '-')}.json`);
    writeFileSync(file, JSON.stringify(snapshot));
  };

  try {
    await saveSnapshot();
    let sinceSnapshot = 0;
    let lastSnapshotAt = Date.now();

    while (!stopping) {
      const result = await doc.changes.list({
        ...(cursor ? { after: cursor } : {}),
        waitMs: 30_000,
        includeUpdate: true,
      });

      for (const record of result.items) {
        if (storedIds.has(record.id)) continue;
        appendFileSync(recordsFile, `${JSON.stringify(record)}\n`);
        storedIds.add(record.id);
        sinceSnapshot += 1;
      }
      cursor = result.cursor ?? '';
      writeFileSync(cursorFile, cursor);

      const idle = result.items.length === 0 && sinceSnapshot > 0;
      const due =
        sinceSnapshot >= SNAPSHOT_EVERY_RECORDS ||
        (sinceSnapshot > 0 && Date.now() - lastSnapshotAt >= SNAPSHOT_EVERY_MS);
      if (result.truncated || idle || due) {
        await saveSnapshot();
        sinceSnapshot = 0;
        lastSnapshotAt = Date.now();
      }
    }
  } finally {
    await doc.close({ discard: true });
  }
} finally {
  await client.dispose();
}
