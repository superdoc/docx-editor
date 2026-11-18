import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createCheckpointScheduler } from '../src/server/checkpoints.ts';
import { handleVersionRequest } from '../src/server/routes.ts';
import type { VersionRecord } from '../src/server/version-store.ts';
import type { VersionService } from '../src/server/versions.ts';

const record: VersionRecord = {
  id: 'v2',
  number: 2,
  label: 'Ann review',
  trigger: 'named',
  createdBy: 'Ann',
  createdAt: '2026-11-04T00:00:00.000Z',
  sha256: '0'.repeat(64),
  byteLength: 1,
};

const notUsed = async (): Promise<never> => {
  throw new Error('not used by this test');
};

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test('an edit made while a named save runs is still checkpointed when the last editor leaves', async (t) => {
  const fired: string[] = [];
  const scheduler = createCheckpointScheduler({
    policy: { idleMs: null, maxIntervalMs: null, whenLastEditorLeaves: true },
    checkpoint: async (_documentId, trigger) => {
      fired.push(trigger);
    },
    log: () => {},
  });
  const versions: VersionService = {
    list: async () => [],
    read: async () => null,
    async save() {
      scheduler.roomChanged('contract');
      return record;
    },
    compare: notUsed,
    restore: notUsed,
    createRoomIfMissing: notUsed,
    dispose: async () => {},
  };
  const server = createServer((request, response) => {
    void handleVersionRequest(request, response, { versions, scheduler, sourceDocx: notUsed });
  });
  const base = await listen(server);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  scheduler.roomChanged('contract');
  const response = await fetch(`${base}/api/documents/contract/versions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label: 'Ann review', createdBy: 'Ann' }),
  });
  assert.equal(response.status, 201);
  assert.deepEqual(scheduler.pending(), ['contract']);

  scheduler.roomEmptied('contract');
  assert.deepEqual(fired, ['last-editor-left']);
});
