import assert from 'node:assert/strict';
import test from 'node:test';
import { Doc, applyUpdate, encodeStateAsUpdate, encodeStateVector, getState } from 'yjs';
import { attributeUpdate } from './attribution-authors';

function client(clientId: number, actorId: string | null): Doc {
  const doc = new Doc();
  doc.clientID = clientId;
  doc.transact(() => {
    doc.getMap('meta').set(`attribution:client:${clientId}`, {
      v: 1,
      actorId,
      name: actorId ?? 'Anonymous',
      sessionId: `session-${clientId}`,
      declaredAt: '2026-11-05T10:00:00.000Z',
    });
  });
  return doc;
}

function edit(doc: Doc, text: string, stamp: Record<string, unknown>): Uint8Array {
  const before = encodeStateVector(doc);
  doc.transact(() => {
    doc.getText('body').insert(0, text);
    doc.getMap('meta').set(`attribution:stamp:${doc.clientID}`, { v: 1, at: '2026-11-05T10:00:05.000Z', ...stamp });
  });
  return encodeStateAsUpdate(doc, before);
}

test('names the clients whose content an update carries, largest first', () => {
  const server = new Doc();
  const alice = client(11, 'alice');
  const bob = client(22, 'bob');
  applyUpdate(server, encodeStateAsUpdate(alice));
  applyUpdate(server, encodeStateAsUpdate(bob));

  const single = edit(alice, 'Hello', { actorType: 'human', cause: 'user' });
  applyUpdate(server, single);
  const one = attributeUpdate(server, single);
  assert.equal(one.maintenance, false);
  assert.deepEqual(
    one.authors.map((author) => [author.clientId, author.declaration?.actorId, author.stamp?.cause]),
    [[11, 'alice', 'user']],
  );

  applyUpdate(bob, encodeStateAsUpdate(server));
  const merged = new Doc();
  applyUpdate(merged, encodeStateAsUpdate(server));
  const beforeMerge = encodeStateVector(merged);
  applyUpdate(merged, edit(bob, 'Longer reply', { actorType: 'code', cause: 'api', changeTag: 'review-7' }));
  applyUpdate(merged, edit(alice, '!', { actorType: 'human', cause: 'user' }));
  const combined = encodeStateAsUpdate(merged, beforeMerge);
  applyUpdate(server, combined);
  const both = attributeUpdate(server, combined);
  assert.deepEqual(
    both.authors.map((author) => [author.declaration?.actorId, author.stamp?.changeTag]),
    [
      ['bob', 'review-7'],
      ['alice', undefined],
    ],
  );
});

test('marks an update that only repeats a maintenance stamp range', () => {
  const server = new Doc();
  const alice = client(33, 'alice');
  applyUpdate(server, encodeStateAsUpdate(alice));
  const before = encodeStateVector(alice);
  const fromClock = getState(alice.store, 33);
  alice.transact(() => {
    alice.getText('body').insert(0, 'seed');
    const toClock = getState(alice.store, 33);
    alice.getMap('meta').set('attribution:stamp:33', {
      v: 1,
      at: '2026-11-05T10:00:05.000Z',
      actorType: 'code',
      cause: 'maintenance',
      fromClock,
      toClock,
    });
  });
  const update = encodeStateAsUpdate(alice, before);
  applyUpdate(server, update);
  assert.equal(attributeUpdate(server, update).maintenance, true);
});
