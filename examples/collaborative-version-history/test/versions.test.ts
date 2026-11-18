import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCheckpointScheduler } from '../src/server/checkpoints.ts';
import { handleVersionRequest } from '../src/server/routes.ts';
import type { DiffResult, DiffSnapshot, VersionDocument, VersionSdkClient } from '../src/server/sdk.ts';
import { createFileVersionStore } from '../src/server/version-store.ts';
import {
  ComparisonBlockedError,
  RestoreConflictError,
  VersionNotFoundError,
  createVersionService,
} from '../src/server/versions.ts';

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

interface FakeRoom {
  text: string;
  beforeApply?: () => void;
  trackedBlocked?: boolean;
  beforeSave?: () => Promise<void>;
  afterSnapshot?: () => Promise<void>;
}

function fakeClient(room: FakeRoom): VersionSdkClient & { opened: string[] } {
  const opened: string[] = [];
  const documentFor = (read: () => string, write: (text: string) => void): VersionDocument => ({
    async save({ out }) {
      await room.beforeSave?.();
      const snapshot = read();
      await room.afterSnapshot?.();
      await writeFile(out, snapshot);
    },
    async close() {},
    diff: {
      capture: async () => ({ fingerprint: read() }) as unknown as DiffSnapshot,
      compare: async ({ targetSnapshot }) => {
        const base = read();
        const target = (targetSnapshot as unknown as { fingerprint: string }).fingerprint;
        const blocked = { status: 'blocked' as const, blockers: [{ code: 'family-apply-lane-unavailable' as const, message: 'blocked' }] };
        const candidate = { status: 'candidate' as const, blockers: [] };
        return {
          baseFingerprint: base,
          targetFingerprint: target,
          summary: { hasChanges: base !== target },
          applyEligibility: { direct: candidate, tracked: room.trackedBlocked ? blocked : candidate },
        } as unknown as DiffResult;
      },
      apply: async ({ diff, changeMode }) => {
        room.beforeApply?.();
        const { baseFingerprint, targetFingerprint } = diff as unknown as { baseFingerprint: string; targetFingerprint: string };
        if (read() !== baseFingerprint) throw Object.assign(new Error('moved'), { code: 'PRECONDITION_FAILED' });
        write(changeMode === 'tracked' ? `[tracked ${baseFingerprint} -> ${targetFingerprint}]` : targetFingerprint);
        return { operationReceipts: [{ reviewItems: changeMode === 'tracked' ? [{}] : [] }] } as never;
      },
    },
  });

  return {
    opened,
    async open({ doc, collaboration }) {
      if (collaboration) {
        opened.push(`room:${collaboration.roomMode}`);
        return documentFor(() => room.text, (text) => (room.text = text));
      }
      let text = await readFile(doc!, 'utf8');
      opened.push(`file:${path.basename(doc!)}`);
      return documentFor(() => text, (next) => (text = next));
    },
    async dispose() {},
  };
}

async function setup(t: test.TestContext, room: FakeRoom) {
  const directory = await mkdtemp(path.join(tmpdir(), 'versions-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createFileVersionStore(directory);
  const client = fakeClient(room);
  const service = createVersionService({
    store,
    serverUrl: 'ws://127.0.0.1:1',
    marker: { name: 'marker', value: 'secret' },
    createClient: () => client,
  });
  t.after(() => service.dispose());
  return { service, store, client };
}

test('saving a version stores what the room contains now', async (t) => {
  const room = { text: 'first draft' };
  const { service } = await setup(t, room);
  const v1 = await service.save('contract', { label: 'Draft', trigger: 'named', createdBy: 'Ann' });
  room.text = 'second draft';
  const v2 = await service.save('contract', { label: 'Next', trigger: 'idle', createdBy: 'Autosave' });

  assert.deepEqual([v1.id, v2.id], ['v1', 'v2']);
  assert.equal(decode((await service.read('contract', 'v1'))!), 'first draft');
  assert.equal(decode((await service.read('contract', 'v2'))!), 'second draft');
});

test('concurrent saves become separate versions in order', async (t) => {
  const { service } = await setup(t, { text: 'shared' });
  const saved = await Promise.all([
    service.save('contract', { label: 'Ann', trigger: 'named', createdBy: 'Ann' }),
    service.save('contract', { label: 'Ben', trigger: 'named', createdBy: 'Ben' }),
  ]);
  assert.deepEqual(saved.map((version) => [version.id, version.createdBy]), [['v1', 'Ann'], ['v2', 'Ben']]);
});

test('comparing returns tracked changes and leaves stored versions untouched', async (t) => {
  const room = { text: 'old terms' };
  const { service } = await setup(t, room);
  await service.save('contract', { label: 'Old', trigger: 'named', createdBy: 'Ann' });
  room.text = 'new terms';
  await service.save('contract', { label: 'New', trigger: 'named', createdBy: 'Ann' });

  const comparison = await service.compare('contract', 'v1', 'v2');
  assert.equal(decode(comparison.docx), '[tracked old terms -> new terms]');
  assert.equal(comparison.reviewItems, 1);
  assert.equal(decode((await service.read('contract', 'v1'))!), 'old terms');
  assert.equal(decode((await service.read('contract', 'v2'))!), 'new terms');
});

test('a pair that cannot be tracked is refused with its blockers', async (t) => {
  const room: FakeRoom = { text: 'a', trackedBlocked: true };
  const { service } = await setup(t, room);
  await service.save('contract', { label: 'A', trigger: 'named', createdBy: 'Ann' });
  room.text = 'b';
  await service.save('contract', { label: 'B', trigger: 'named', createdBy: 'Ann' });
  await assert.rejects(service.compare('contract', 'v1', 'v2'), ComparisonBlockedError);
  await assert.rejects(service.compare('contract', 'v1', 'v9'), VersionNotFoundError);
});

test('restoring keeps the current state, changes the room and records a new version', async (t) => {
  const room = { text: 'original' };
  const { service } = await setup(t, room);
  await service.save('contract', { label: 'Original', trigger: 'named', createdBy: 'Server' });
  room.text = 'edited';
  await service.save('contract', { label: 'Edited', trigger: 'named', createdBy: 'Ann' });
  room.text = 'edited and not yet saved';

  const result = await service.restore('contract', { versionId: 'v1', baseVersionId: 'v2', requestedBy: 'Ben' });
  assert.equal(room.text, 'original');
  assert.deepEqual(
    [result.before.id, result.before.trigger, result.restored.id, result.restored.trigger, result.restored.restoredFrom],
    ['v3', 'before-restore', 'v4', 'restore', 'v1'],
  );
  assert.equal(decode((await service.read('contract', 'v3'))!), 'edited and not yet saved');
  assert.equal(decode((await service.read('contract', 'v4'))!), 'original');
  assert.deepEqual((await service.list('contract')).map((version) => version.id), ['v1', 'v2', 'v3', 'v4']);
});

test('restoring from an outdated version is refused before anything changes', async (t) => {
  const room = { text: 'one' };
  const { service } = await setup(t, room);
  await service.save('contract', { label: 'One', trigger: 'named', createdBy: 'Ann' });
  room.text = 'two';
  await service.save('contract', { label: 'Two', trigger: 'named', createdBy: 'Ben' });

  await assert.rejects(
    service.restore('contract', { versionId: 'v1', baseVersionId: 'v1', requestedBy: 'Ann' }),
    (error: unknown) => error instanceof RestoreConflictError && error.reason === 'stale-base' && error.head?.id === 'v2',
  );
  assert.equal(room.text, 'two');
  assert.equal((await service.list('contract')).length, 2);
});

test('a room edit during restore stops the restore without overwriting it', async (t) => {
  const room: FakeRoom = { text: 'one' };
  const { service } = await setup(t, room);
  await service.save('contract', { label: 'One', trigger: 'named', createdBy: 'Ann' });
  room.text = 'two';
  await service.save('contract', { label: 'Two', trigger: 'named', createdBy: 'Ann' });
  room.beforeApply = () => {
    room.text = 'two plus a peer edit';
  };

  await assert.rejects(
    service.restore('contract', { versionId: 'v1', baseVersionId: 'v2', requestedBy: 'Ann' }),
    (error: unknown) => error instanceof RestoreConflictError && error.reason === 'room-changed',
  );
  assert.equal(room.text, 'two plus a peer edit');
  const versions = await service.list('contract');
  assert.deepEqual(versions.map((version) => version.trigger), ['named', 'named', 'before-restore']);
});

test('restoring the version the room already matches still records the restore', async (t) => {
  const room = { text: 'same' };
  const { service } = await setup(t, room);
  await service.save('contract', { label: 'Same', trigger: 'named', createdBy: 'Ann' });
  const result = await service.restore('contract', { versionId: 'v1', baseVersionId: 'v1', requestedBy: 'Ann' });
  assert.equal(result.restored.restoredFrom, 'v1');
  assert.equal(room.text, 'same');
});

test('creating a missing room opens it in create mode', async (t) => {
  const { service, client } = await setup(t, { text: 'seed' });
  assert.equal(await service.createRoomIfMissing('contract', encode('seed')), 'created');
  assert.deepEqual(client.opened, ['room:create']);
});

test('automatic checkpoints reuse an unchanged export while named saves and later edits remain distinct', async (t) => {
  const room = { text: 'acknowledged content' };
  const { service } = await setup(t, room);
  const named = await service.save('contract', { label: 'Named', trigger: 'named', createdBy: 'Ann' });
  for (const trigger of ['idle', 'interval', 'last-editor-left', 'shutdown'] as const) {
    const automatic = await service.save('contract', { label: trigger, trigger, createdBy: 'Autosave' });
    assert.equal(automatic.id, named.id);
  }
  assert.equal((await service.list('contract')).length, 1);
  const secondNamed = await service.save('contract', { label: 'Independent approval', trigger: 'named', createdBy: 'Ben' });
  assert.equal(secondNamed.id, 'v2');
  room.text = 'late edit after the acknowledged snapshot';
  const later = await service.save('contract', { label: 'Recover late edit', trigger: 'shutdown', createdBy: 'Autosave' });
  assert.equal(later.id, 'v3');
  assert.equal(decode((await service.read('contract', 'v3')) ?? new Uint8Array()), room.text);
  assert.equal(decode((await service.read('contract', 'v1')) ?? new Uint8Array()), 'acknowledged content');
});

for (const included of [true, false]) {
  test(included ? 'shutdown reuses the named snapshot when a concurrent update was included in its export'
    : 'shutdown persists a concurrent update outside the acknowledged named snapshot', async (t) => {
    const room: FakeRoom = { text: 'initial content' };
    const { service } = await setup(t, room);
    await service.save('contract', { label: 'Initial', trigger: 'named', createdBy: 'Server' });
    const scheduler = createCheckpointScheduler({
      policy: { idleMs: null, maxIntervalMs: null, whenLastEditorLeaves: false },
      checkpoint: (documentId, trigger) => service.save(documentId, { label: trigger, trigger, createdBy: 'Autosave' }),
    });
    const server = createServer((request, response) => {
      void handleVersionRequest(request, response, { versions: service, scheduler, sourceDocx: async () => new Uint8Array() });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
    t.after(() => scheduler.stop());
    const address = server.address();
    assert(address && typeof address !== 'string');
    room.text = 'content at the save request';
    scheduler.roomChanged('contract');
    let started = () => {};
    let release = () => {};
    const startedSaving = new Promise<void>(resolve => { started = resolve; });
    const canExport = new Promise<void>(resolve => { release = resolve; });
    const updateDuringSave = async () => {
      room.beforeSave = undefined;
      room.afterSnapshot = undefined;
      started();
      await canExport;
      room.text = 'concurrent peer content';
      scheduler.roomChanged('contract');
    };
    if (included) room.beforeSave = updateDuringSave;
    else room.afterSnapshot = updateDuringSave;
    const saving = fetch(`http://127.0.0.1:${address.port}/api/documents/contract/versions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'Named checkpoint', createdBy: 'Ann' }),
    });
    await startedSaving;
    release();
    assert.equal((await saving).status, 201);
    const namedBytes = await service.read('contract', 'v2');
    assert(namedBytes);
    assert.equal(decode(namedBytes), included ? room.text : 'content at the save request');
    assert.deepEqual(scheduler.pending(), ['contract']);
    await scheduler.stop();
    const versions = await service.list('contract');
    assert.deepEqual(versions.map(version => version.id), included ? ['v1', 'v2'] : ['v1', 'v2', 'v3']);
    const latest = versions.at(-1);
    assert(latest);
    assert.equal(decode((await service.read('contract', latest.id)) ?? new Uint8Array()), 'concurrent peer content');
    assert.deepEqual(await service.read('contract', 'v2'), namedBytes);
  });
}
