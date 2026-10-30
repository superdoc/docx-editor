import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { DocxAutosave } from '../src/docx/autosave.ts';
import { connect, startServer, waitFor } from './helpers.ts';

const ROOM = 'sd2/v2.1/contract-42';

function recorder() {
  const events = { changed: [] as string[], emptied: [] as string[] };
  const autosave: DocxAutosave = {
    marker: { name: 'superdocAutosave', value: 'the-marker' },
    roomChanged: (room) => events.changed.push(room),
    roomEmptied: (room) => events.emptied.push(room),
    flush: async () => {},
    stop: async () => {},
  };
  return { autosave, events };
}

test('the server reports editor changes and empty rooms, and ignores the autosave connection', async (t) => {
  const storageDirectory = await mkdtemp(path.join(tmpdir(), 'collaboration-server-'));
  t.after(() => rm(storageDirectory, { recursive: true, force: true }));
  const { autosave, events } = recorder();
  const running = await startServer(t, { storageDirectory, docxAutosave: autosave });

  const alice = await connect(running, ROOM);
  alice.document.getText('body').insert(0, 'From Alice. ');
  await waitFor(() => events.changed.length > 0, 'the change report');
  const afterAlice = events.changed.length;

  const saver = await connect(running, ROOM, { parameters: { superdocAutosave: 'the-marker' } });
  saver.document.getText('body').insert(0, 'From the autosave. ');
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(events.changed.length, afterAlice, 'changes from the autosave connection are ignored');

  const impostor = await connect(running, ROOM, { parameters: { superdocAutosave: 'a-guess' } });
  impostor.document.getText('body').insert(0, 'From a guess. ');
  await waitFor(() => events.changed.length > afterAlice, 'a change from a wrong marker to count');

  saver.leave();
  impostor.leave();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(events.emptied, [], 'the room is not empty while Alice is connected');

  alice.leave();
  await waitFor(() => events.emptied.length === 1, 'the empty-room report');
  assert.deepEqual(events.emptied, [ROOM]);
});

test('loading a stored room is not reported as a change', async (t) => {
  const storageDirectory = await mkdtemp(path.join(tmpdir(), 'collaboration-server-'));
  t.after(() => rm(storageDirectory, { recursive: true, force: true }));
  const { autosave, events } = recorder();
  const running = await startServer(t, { storageDirectory, docxAutosave: autosave });

  const alice = await connect(running, ROOM);
  alice.document.getText('body').insert(0, 'Stored text.');
  await waitFor(() => events.changed.length > 0, 'the change report');
  alice.leave();
  await waitFor(() => running.server.getDocumentsCount() === 0, 'the room to unload');
  const before = events.changed.length;

  const bob = await connect(running, ROOM);
  assert.equal(bob.document.getText('body').toString(), 'Stored text.');
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(events.changed.length, before, 'restoring the room from storage is not an edit');
});
