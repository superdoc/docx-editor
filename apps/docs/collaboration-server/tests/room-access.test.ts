import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { authorizeRoom, issueRoom, ROOM_LIFETIME_MS } from '../src/room-access.ts';

const secret = 'test-only-room-signing-secret';
function roomUrl(documentId: string, token: string) {
  return new URL(`https://demo.example/rooms/sd2/v2.1/${documentId}?token=${token}`);
}

test('room credentials are isolated, signed and expire without extending on reconnect', async () => {
  const now = Date.now();
  const first = await issueRoom(secret, now);
  const second = await issueRoom(secret, now);
  assert.notEqual(first.documentId, second.documentId);
  const url = roomUrl(first.documentId, first.token);
  assert.equal(await authorizeRoom(url, secret, now), first.documentId);
  assert.equal(await authorizeRoom(url, secret, now + ROOM_LIFETIME_MS - 1), first.documentId);
  assert.equal(await authorizeRoom(url, secret, now + ROOM_LIFETIME_MS), null);
  assert.equal(await authorizeRoom(url, 'wrong-secret', now), null);
  assert.equal(await authorizeRoom(roomUrl(second.documentId, first.token), secret, now), null);
  assert.equal(await authorizeRoom(roomUrl(first.documentId, 'bad'), secret, now), null);
  url.pathname += '/another-room';
  assert.equal(await authorizeRoom(url, secret, now), null);
});
