import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { createExampleAuthorize, signExampleToken, type ExampleTokenClaims } from '../src/auth/example-token.ts';
import { connect, open, startServer } from './helpers.ts';

const SECRET = 'test-secret-that-is-at-least-32-characters';
const ROOM = 'sd2/v2.1/contract-42';

const token = (claims: Partial<ExampleTokenClaims>, secret = SECRET) =>
  signExampleToken(secret, { sub: 'alice', documents: ['contract-42'], exp: Math.floor(Date.now() / 1000) + 60, ...claims });

async function start(t: TestContext) {
  const storageDirectory = await mkdtemp(path.join(tmpdir(), 'collaboration-server-'));
  t.after(() => rm(storageDirectory, { recursive: true, force: true }));
  return startServer(t, { storageDirectory, authorize: createExampleAuthorize(SECRET) });
}

test('a valid token for the document opens the room', async (t) => {
  const running = await start(t);
  assert.equal((await open(running, ROOM, { token: token({}) })).outcome, 'synced');
});

test('a connection without a token never gets into the room', async (t) => {
  const running = await start(t);
  for (const value of [undefined, '']) {
    assert.equal((await open(running, ROOM, { token: value, waitMs: 1000 })).outcome, 'pending');
  }
  assert.equal(running.server.getConnectionsCount(), 0);
});

test('a connection without a valid token for the document is refused', async (t) => {
  const running = await start(t);
  const refused = {
    'wrong secret': token({}, 'a-different-secret-of-at-least-32-chars'),
    expired: token({ exp: Math.floor(Date.now() / 1000) - 1 }),
    'another document': token({ documents: ['contract-43'] }),
    'not a token': 'hello',
  };
  for (const [name, value] of Object.entries(refused)) {
    assert.equal((await open(running, ROOM, { token: value })).outcome, 'denied', name);
  }
  assert.equal(
    (await open(running, 'not-a-superdoc-room', { token: token({ documents: '*' }) })).outcome,
    'denied',
    'a room name that is not a SuperDoc room',
  );
});

test('a read-only token follows the room but its edits are dropped', async (t) => {
  const running = await start(t);
  const writer = await connect(running, ROOM, { token: token({ sub: 'alice' }) });
  const reader = await connect(running, ROOM, { token: token({ sub: 'bob', readOnly: true }) });

  writer.document.getText('body').insert(0, 'From Alice. ');
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(reader.document.getText('body').toString(), 'From Alice. ', 'the reader receives edits');

  reader.document.getText('body').insert(0, 'From Bob. ');
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(writer.document.getText('body').toString(), 'From Alice. ', 'the reader edit never reaches the writer');
  assert.equal(running.server.documents.get(ROOM)?.getText('body').toString(), 'From Alice. ', 'or the server');
});
