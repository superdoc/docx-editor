import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { Doc, applyUpdate } from 'yjs';
import { createFileRoomStore } from '../src/storage/file.ts';
import { createCollaborationServer } from '../src/create-server.ts';
import { freePort, waitFor } from './helpers.ts';

test('the storage commitment waits for the backing write and correlates its acknowledgement', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sd5967-commit-'));
  const file = createFileRoomStore(directory);
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const server = createCollaborationServer({ port: await freePort(), host: '127.0.0.1', authorize: null, docxAutosave: null, debounceMs: 60_000, maxDebounceMs: 60_000,
    roomStore: { load: file.load, delete: file.delete, async store(name, state) { await gate; await file.store(name, state); } },
  });
  await server.listen();
  const document = new Doc();
  const socket = new HocuspocusProviderWebsocket({ url: server.webSocketURL });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: 'sd2/v2.1/commit', document });
  t.after(async () => { release(); provider.destroy(); socket.destroy(); await server.destroy(); document.destroy(); await rm(directory, { recursive: true, force: true }); });
  await waitFor(() => provider.synced, 'the client to sync');
  document.getText('body').insert(0, 'Committed terms.');
  await waitFor(() => !provider.hasUnsyncedChanges, 'the server to receive the edit');
  const id = randomUUID();
  const replies: unknown[] = [];
  provider.on('stateless', ({ payload }: { payload: string }) => { replies.push(JSON.parse(payload)); });
  provider.sendStateless(JSON.stringify({ protocol: 'superdoc-room-storage-v1', id, action: 'commit' }));
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(replies.length, 0);
  assert.equal(await file.load('sd2/v2.1/commit'), null);
  release();
  await waitFor(() => replies.length > 0, 'the correlated storage acknowledgement');
  assert.equal(replies.length, 1);
  const reply = replies[0];
  assert.ok(reply && typeof reply === 'object' && 'id' in reply && 'stored' in reply);
  assert.equal(reply.id, id);
  assert.equal(reply.stored, true);
  const saved = new Doc();
  const state = await file.load('sd2/v2.1/commit');
  assert.ok(state);
  applyUpdate(saved, state);
  assert.equal(saved.getText('body').toString(), 'Committed terms.');
  saved.destroy();
});
