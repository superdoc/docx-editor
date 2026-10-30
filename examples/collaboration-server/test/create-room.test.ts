import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoom, RoomExistsError } from '../src/create-room.ts';
import type { SdkClient } from '../src/sdk.ts';

type Step = { client: number; action: string; roomMode?: string; doc?: string; token?: string; discard?: boolean };

function fakeSdk(failOn?: { roomMode: 'create' | 'join'; error: Error & { code?: string } }) {
  const steps: Step[] = [];
  let clients = 0;
  const createClient = (): SdkClient => {
    const client = ++clients;
    return {
      async open(params, options) {
        const { roomMode } = params.collaboration;
        steps.push({ client, action: 'open', roomMode, doc: params.doc, token: options?.collaborationAuth.token });
        if (failOn?.roomMode === roomMode) throw failOn.error;
        return {
          async save() {},
          async close(closeParams) {
            steps.push({ client, action: 'close', roomMode, discard: closeParams?.discard });
          },
        };
      },
      async dispose() {
        steps.push({ client, action: 'dispose' });
      },
    };
  };
  return { steps, createClient };
}

const options = { serverUrl: 'ws://127.0.0.1:1234', documentId: 'contract-42', docxPath: './contract.docx', token: 't' };

test('creates the room, then keeps the creator connected until a fresh client joins it', async () => {
  const { steps, createClient } = fakeSdk();
  await createRoom({ ...options, createClient });
  assert.deepEqual(steps, [
    { client: 1, action: 'open', roomMode: 'create', doc: './contract.docx', token: 't' },
    { client: 2, action: 'open', roomMode: 'join', doc: undefined, token: 't' },
    { client: 2, action: 'close', roomMode: 'join', discard: true },
    { client: 1, action: 'close', roomMode: 'create', discard: true },
    { client: 1, action: 'dispose' },
    { client: 2, action: 'dispose' },
  ]);
});

test('an existing room is reported, never re-created or joined', async () => {
  const error = Object.assign(new Error('create intent targeted an already-committed room'), {
    code: 'COLLABORATION_ROOM_ALREADY_EXISTS',
  });
  const { steps, createClient } = fakeSdk({ roomMode: 'create', error });
  await assert.rejects(createRoom({ ...options, createClient }), RoomExistsError);
  assert.deepEqual(
    steps.map((s) => s.action),
    ['open', 'dispose', 'dispose'],
  );
});

test('if the check fails the error surfaces and the creator still disconnects', async () => {
  const error = Object.assign(new Error('not ready'), { code: 'COLLABORATION_SYNC_TIMEOUT' });
  const { steps, createClient } = fakeSdk({ roomMode: 'join', error });
  await assert.rejects(createRoom({ ...options, createClient }), /not ready/);
  assert.ok(steps.some((s) => s.client === 1 && s.action === 'close'));
  assert.equal(steps.filter((s) => s.action === 'dispose').length, 2);
});

test('other create failures surface unchanged, and no token is sent when there is none', async () => {
  const error = Object.assign(new Error('server unreachable'), { code: 'COLLABORATION_SYNC_TIMEOUT' });
  const { steps, createClient } = fakeSdk({ roomMode: 'create', error });
  await assert.rejects(createRoom({ ...options, token: undefined, createClient }), /server unreachable/);
  assert.equal(steps[0]!.token, undefined);
});
