import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { Doc, applyUpdate, encodeStateAsUpdate } from 'yjs';
import { createSqliteRoomStore } from '../src/storage/sqlite.ts';
import { createCollaborationServer } from '../src/create-server.ts';
import { freePort, waitFor } from './helpers.ts';

const ROOM = 'sd2/v2.1/process-room';

async function start(filename: string, gatedAuth = false) {
  const child = fork(new URL('./fixtures/storage-process.ts', import.meta.url), [filename, '0', gatedAuth ? 'gated-auth' : ''], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const result: unknown[] = [];
  child.on('message', value => { result.push(value); });
  await waitFor(() => result.length > 0 || child.exitCode !== null, 'the separate server process to start');
  const ready = result[0];
  assert.ok(ready && typeof ready === 'object' && 'url' in ready && typeof ready.url === 'string');
  return { child, url: ready.url, messages: result };
}

async function command(child: ChildProcess, type: string) {
  const id = randomUUID();
  const response = new Promise<void>((resolve, reject) => {
    const onMessage = (value: unknown) => {
      if (!value || typeof value !== 'object' || !('id' in value) || value.id !== id) return;
      child.off('message', onMessage);
      if ('error' in value) reject(new Error(String(value.error))); else resolve();
    };
    child.on('message', onMessage);
    child.send({ id, type, room: ROOM });
  });
  await response;
}

async function connect(url: string, token?: string, awaitSync = true) {
  const document = new Doc();
  const socket = new HocuspocusProviderWebsocket({ url });
  let authenticationFailed = false;
  const provider = new HocuspocusProvider({ websocketProvider: socket, document, name: ROOM, ...(token === undefined ? {} : { token }), onAuthenticationFailed() { authenticationFailed = true; provider.disconnect(); } });
  let closeCode: number | undefined;
  provider.on('close', ({ event }: { event: { code: number } }) => { closeCode = event.code; if (event.code === 4403) provider.disconnect(); });
  provider.on('stateless', ({ payload }: { payload: string }) => {
    const message: unknown = JSON.parse(payload);
    if (message && typeof message === 'object' && 'generation' in message && typeof message.generation === 'string') socket.configuration.parameters.sdRoomGeneration = message.generation;
  });
  if (awaitSync) {
    try { await waitFor(() => provider.synced, 'the client to finish its initial local sync'); }
    catch (error) { provider.destroy(); socket.destroy(); document.destroy(); throw error; }
  }
  return { document, provider, socket, rejected: () => authenticationFailed, closeCode: () => closeCode, destroy() { provider.destroy(); socket.destroy(); document.destroy(); } };
}

async function synchronize(client: Awaited<ReturnType<typeof connect>>, action: 'initial' | 'commit') {
  await waitFor(() => !client.provider.hasUnsyncedChanges, 'the server to receive preceding edits');
  const id = randomUUID();
  return new Promise<{ id: string; stored: boolean }>((resolve, reject) => {
    const finish = () => { clearTimeout(timer); client.provider.off('stateless', onReply); };
    const onReply = ({ payload }: { payload: string }) => {
      const reply: unknown = JSON.parse(payload);
      if (!reply || typeof reply !== 'object' || !('id' in reply) || reply.id !== id) return;
      finish();
      if ('error' in reply) { reject(new Error(String(reply.error))); return; }
      if (!('stored' in reply) || typeof reply.stored !== 'boolean' || !('state' in reply) || typeof reply.state !== 'string') { reject(new Error('Invalid reply')); return; }
      applyUpdate(client.document, Buffer.from(reply.state, 'base64'));
      resolve({ id, stored: reply.stored });
    };
    const timer = setTimeout(() => { finish(); reject(new Error('Storage response timed out.')); }, 5_000);
    client.provider.on('stateless', onReply);
    client.provider.sendStateless(JSON.stringify({ protocol: 'superdoc-room-storage-v1', id, action }));
  });
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'sd5967-process-'));
  const database = join(directory, 'rooms.sqlite');
  const processes: ChildProcess[] = [];
  const clients: Awaited<ReturnType<typeof connect>>[] = [];
  const readback = await createSqliteRoomStore(database);
  t.after(async () => {
    for (const client of clients) client.destroy();
    await Promise.all(processes.map(async child => { if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; } }));
    readback.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { database, readback, async server(gatedAuth = false) { const result = await start(database, gatedAuth); processes.push(result.child); return result; }, async client(url: string, token?: string, awaitSync = true) { const client = await connect(url, token, awaitSync); clients.push(client); return client; } };
}

const hasMessage = (messages: unknown[], type: string) => messages.some(value => value !== null && typeof value === 'object' && 'type' in value && value.type === type);

test('immediate authorization initializes a coordinated admission before loading its room', { timeout: 15_000 }, async t => {
  const f = await fixture(t);
  const b = await f.server(true);
  const client = await f.client(b.url, 'immediate');
  client.document.getText('body').insert(0, 'AUTHORIZED');
  await synchronize(client, 'commit');
  const fresh = await f.client(b.url, 'immediate');
  await synchronize(fresh, 'initial');
  assert.equal(fresh.document.getText('body').toString(), 'AUTHORIZED');
});

test('delayed authentication cannot restore old content through an already loaded reset replacement', { timeout: 15_000 }, async t => {
  const f = await fixture(t);
  const a = await f.server();
  const b = await f.server(true);
  const owner = await f.client(a.url);
  owner.document.getText('body').insert(0, 'OLD');
  await synchronize(owner, 'commit');
  const held = await f.client(b.url, 'held-auth', false);
  await waitFor(() => hasMessage(b.messages, 'authentication-held'), 'the old admission to wait in authentication');
  applyUpdate(held.document, encodeStateAsUpdate(owner.document));
  held.document.getText('body').insert(3, ' STALE');
  try {
    await command(a.child, 'delete');
    const replacement = await f.client(b.url, 'allowed');
    replacement.document.getText('body').insert(0, 'NEW');
    await synchronize(replacement, 'commit');
    await command(b.child, 'release-auth');
    await waitFor(() => replacement.document.getText('body').toString().includes('OLD') || held.rejected() || held.closeCode() !== undefined, 'the stale admission to be rejected or expose contamination');
    await synchronize(replacement, 'commit');
    const bytes = await f.readback.load(ROOM);
    assert.ok(bytes);
    const stored = new Doc();
    try {
      applyUpdate(stored, bytes);
      assert.equal(stored.getText('body').toString(), 'NEW');
      assert.equal(held.provider.synced, false);
    } finally { stored.destroy(); }
  } finally { await command(b.child, 'release-auth'); }
});

test('concurrent initial admissions survive delayed authentication with cold and already loaded rooms', { timeout: 15_000 }, async t => {
  for (const warm of [false, true]) {
    const f = await fixture(t);
    const a = await f.server();
    const b = await f.server(true);
    const held = await f.client(b.url, 'held-auth', false);
    await waitFor(() => hasMessage(b.messages, 'authentication-held'), 'the empty-room admission to wait in authentication');
    try {
      const owner = await f.client(a.url);
      owner.document.getText('body').insert(0, 'INITIAL');
      await synchronize(owner, 'commit');
      if (warm) await f.client(b.url, 'allowed');
      await command(b.child, 'release-auth');
      await waitFor(() => held.provider.synced || held.rejected() || held.closeCode() !== undefined, 'the concurrent initial admission to finish');
      assert.equal(held.provider.synced, true, `Initial admission with warm=${warm} must remain valid.`);
      await synchronize(held, 'initial');
      assert.equal(held.document.getText('body').toString(), 'INITIAL');
      held.document.getText('body').insert(7, ' AGENT');
      await synchronize(held, 'commit');
      const fresh = await f.client(a.url);
      await synchronize(fresh, 'initial');
      assert.equal(fresh.document.getText('body').toString(), 'INITIAL AGENT');
    } finally { await command(b.child, 'release-auth'); }
  }
});

test('separate OS instances preserve committed edits, deletion-only updates, late joins and a fresh-server reopen', async t => {
  const f = await fixture(t);
  const a = await f.server();
  const b = await f.server();
  assert.notEqual(a.child.pid, b.child.pid);
  assert.notEqual(a.child.pid, process.pid);
  t.diagnostic(JSON.stringify({ instanceAPid: a.child.pid, instanceBPid: b.child.pid, testPid: process.pid, database: f.database }));
  const owner = await f.client(a.url);
  const alreadyJoined = await f.client(b.url);
  owner.document.getText('body').insert(0, 'Keep 删除 me.');
  const receipt = await synchronize(owner, 'commit');
  assert.equal(receipt.stored, true);
  await synchronize(alreadyJoined, 'initial');
  assert.equal(alreadyJoined.document.getText('body').toString(), 'Keep 删除 me.');
  owner.document.getText('body').delete(5, 3);
  await synchronize(owner, 'commit');
  await synchronize(alreadyJoined, 'initial');
  assert.equal(alreadyJoined.document.getText('body').toString(), 'Keep me.');
  alreadyJoined.document.getText('body').insert(8, ' B');
  owner.document.getText('body').insert(0, 'A ');
  await Promise.all([synchronize(owner, 'commit'), synchronize(alreadyJoined, 'commit')]);
  await synchronize(owner, 'initial');
  assert.equal(owner.document.getText('body').toString(), 'A Keep me. B');
  const stored = await f.readback.load(ROOM);
  assert.ok(stored);
  const disk = new Doc();
  applyUpdate(disk, stored);
  assert.equal(disk.getText('body').toString(), 'A Keep me. B');
  disk.destroy();
  const c = await f.server();
  const fresh = await f.client(c.url);
  await synchronize(fresh, 'initial');
  assert.equal(fresh.document.getText('body').toString(), 'A Keep me. B');
});

test('a backing database failure rejects commitment while previously committed content survives restart', async t => {
  const f = await fixture(t);
  const a = await f.server();
  const owner = await f.client(a.url);
  owner.document.getText('body').insert(0, 'Stored.');
  await synchronize(owner, 'commit');
  await command(a.child, 'fail-storage');
  await assert.rejects(synchronize(owner, 'commit'), /STORAGE_FAILED/);
  const b = await f.server();
  const fresh = await f.client(b.url);
  await synchronize(fresh, 'initial');
  assert.equal(fresh.document.getText('body').toString(), 'Stored.');
});

test('reset generations fence an offline client and a still-connected other server before reseeding', { timeout: 15_000 }, async t => {
  const f = await fixture(t);
  const a = await f.server();
  const b = await f.server();
  const offline = await f.client(a.url);
  const remote = await f.client(b.url);
  offline.document.getText('body').insert(0, 'OLD');
  await synchronize(offline, 'commit');
  await synchronize(remote, 'initial');
  offline.provider.disconnect();
  offline.document.getText('body').insert(0, 'OFFLINE ');
  await command(a.child, 'delete');
  await waitFor(() => remote.closeCode() === 4403, 'the other process to reject the deleted generation');
  const replacement = await f.client(a.url);
  replacement.document.getText('body').insert(0, 'NEW');
  await synchronize(replacement, 'commit');
  void offline.provider.connect();
  await waitFor(() => offline.closeCode() === 4403, 'the offline old-generation client to be refused');
  const fresh = await f.client(b.url);
  await synchronize(fresh, 'initial');
  assert.equal(fresh.document.getText('body').toString(), 'NEW');
  const held = new Promise<void>(resolve => {
    const onMessage = (value: unknown) => {
      if (value && typeof value === 'object' && 'type' in value && value.type === 'read-held') {
        b.child.off('message', onMessage);
        resolve();
      }
    };
    b.child.on('message', onMessage);
  });
  await command(b.child, 'hold-read');
  await held;
  try {
    await command(a.child, 'delete');
    const reseeded = await f.client(a.url);
    reseeded.document.getText('body').insert(0, 'FINAL');
    await synchronize(reseeded, 'commit');
    const admitted = await f.client(b.url);
    assert.equal(admitted.document.getText('body').toString(), 'FINAL');
    await command(b.child, 'release-read');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.notEqual(admitted.closeCode(), 4403);
    admitted.document.getText('body').insert(5, ' CURRENT');
    await synchronize(admitted, 'commit');
    assert.equal(admitted.document.getText('body').toString(), 'FINAL CURRENT');
  } finally { await command(b.child, 'release-read'); }
});

test('rejected authentication cannot allocate a persistent room generation', async t => {
  const f = await fixture(t);
  const storage = await createSqliteRoomStore(f.database);
  const server = createCollaborationServer({ port: await freePort(), host: '127.0.0.1', roomStore: storage, authorize: async () => null, docxAutosave: null });
  await server.listen();
  let rejected = false;
  const document = new Doc();
  const socket = new HocuspocusProviderWebsocket({ url: server.webSocketURL });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: ROOM, document, token: 'rejected', onAuthenticationFailed() { rejected = true; provider.disconnect(); } });
  t.after(async () => { provider.destroy(); socket.destroy(); await server.destroy(); storage.close(); document.destroy(); });
  await waitFor(() => rejected, 'authentication to be rejected');
  assert.equal((await f.readback.coordination?.read(ROOM))?.generation, '');
  assert.equal(await f.readback.load(ROOM), null);
});

test('neither an old generation nor an unfenced snapshot can repopulate a reset SQLite room', async t => {
  const f = await fixture(t);
  const coordination = f.readback.coordination;
  assert.ok(coordination);
  const before = await coordination.open(ROOM);
  const stale = new Doc();
  stale.getText('body').insert(0, 'OLD SNAPSHOT');
  const bytes = encodeStateAsUpdate(stale);
  stale.destroy();
  await f.readback.delete(ROOM);
  await assert.rejects(coordination.commit(ROOM, before.generation, bytes), /Room was reset/);
  await assert.rejects(f.readback.store(ROOM, bytes), /generation-fenced/);
  assert.equal(await f.readback.load(ROOM), null);
});
