import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import { Doc } from 'yjs';
import { issueRoom, ROOM_LIFETIME_MS } from '../src/room-access.ts';

const base = process.env.DEMO_SERVER_URL;
const origin = process.env.DEMO_ORIGIN ?? 'http://localhost:3016';
class DemoSocket extends WebSocket {
  constructor(url: string) {
    super(url, { origin });
  }
}

async function room() {
  const response = await fetch(`${base}/rooms`, { method: 'POST', headers: { Origin: origin } });
  assert.equal(response.status, 200);
  return response.json() as Promise<{ documentId: string; token: string }>;
}
async function client(room: { documentId: string; token: string }) {
  const document = new Doc();
  const provider = new WebsocketProvider(
    base!.replace(/^http/, 'ws') + '/rooms',
    `sd2/v2.1/${room.documentId}`,
    document,
    {
      params: { token: room.token },
      WebSocketPolyfill: DemoSocket as unknown as NonNullable<
        ConstructorParameters<typeof WebsocketProvider>[3]
      >['WebSocketPolyfill'],
      disableBc: true,
    },
  );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Sync timed out')), 10000);
    provider.on('sync', (synced: boolean) => {
      if (synced) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  return {
    document,
    provider,
    destroy() {
      provider.destroy();
      provider.awareness.destroy();
      document.destroy();
    },
  };
}

test(
  'real y-websocket clients synchronize, reconnect, and remain isolated',
  { skip: !base, timeout: 30000 },
  async () => {
    const credentials = await room();
    const alex = await client(credentials);
    const sam = await client(credentials);
    const other = await client(await room());
    try {
      let update = new Promise<void>((resolve) => sam.document.once('update', () => resolve()));
      alex.document.getText('test').insert(0, 'Monday');
      await update;
      assert.equal(sam.document.getText('test').toString(), 'Monday');
      update = new Promise<void>((resolve) => alex.document.once('update', () => resolve()));
      sam.document.getText('test').insert(6, ' Friday');
      await update;
      assert.equal(alex.document.getText('test').toString(), 'Monday Friday');
      assert.equal(other.document.getText('test').toString(), '');
      const awareness = new Promise<void>((resolve) => sam.provider.awareness.once('change', () => resolve()));
      alex.provider.awareness.setLocalStateField('user', { name: 'Alex', color: '#1355ff' });
      await awareness;
      assert.equal(sam.provider.awareness.getStates().get(alex.document.clientID)?.user.name, 'Alex');
      alex.destroy();
      sam.destroy();
      const rejoined = await client(credentials);
      assert.equal(rejoined.document.getText('test').toString(), 'Monday Friday');
      rejoined.destroy();
    } finally {
      alex.destroy();
      sam.destroy();
      other.destroy();
    }
  },
);

test('rejects cross-origin admission and forged credentials', { skip: !base, timeout: 10000 }, async () => {
  assert.equal(
    (await fetch(`${base}/rooms`, { method: 'POST', headers: { Origin: 'https://evil.example' } })).status,
    403,
  );
  const credentials = await room();
  const socket = new DemoSocket(`${base!.replace(/^http/, 'ws')}/rooms/sd2/v2.1/${credentials.documentId}?token=bad`);
  await new Promise<void>((resolve, reject) => {
    socket.on('unexpected-response', (_request, response) => {
      assert.equal(response.statusCode, 403);
      response.resume();
      socket.terminate();
      resolve();
    });
    socket.on('open', () => reject(new Error('Invalid credential accepted')));
    socket.on('error', () => {});
  });
});

test(
  'closes live sockets when the signed room expires',
  { skip: !base || !process.env.DEMO_TEST_SECRET, timeout: 10000 },
  async () => {
    const credentials = await issueRoom(process.env.DEMO_TEST_SECRET!, Date.now() - ROOM_LIFETIME_MS + 2000);
    const socket = new DemoSocket(
      `${base!.replace(/^http/, 'ws')}/rooms/sd2/v2.1/${credentials.documentId}?token=${credentials.token}`,
    );
    await new Promise<void>((resolve, reject) => {
      socket.on('close', (code) => {
        try {
          assert.equal(code, 4001);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      socket.on('error', reject);
    });
  },
);

test('rejects oversize messages and a fifth connection', { skip: !base, timeout: 10000 }, async () => {
  const credentials = await room();
  const url = `${base!.replace(/^http/, 'ws')}/rooms/sd2/v2.1/${credentials.documentId}?token=${credentials.token}`;
  const sockets: DemoSocket[] = [];
  try {
    for (let index = 0; index < 4; index++) {
      const socket = new DemoSocket(url);
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.on('open', resolve);
        socket.on('error', reject);
      });
    }
    const fifth = new DemoSocket(url);
    sockets.push(fifth);
    await new Promise<void>((resolve, reject) => {
      fifth.on('close', (code) => {
        try {
          assert.equal(code, 4002);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      fifth.on('error', reject);
    });
    const closed = new Promise<void>((resolve, reject) => {
      sockets[0]!.on('close', (code) => {
        try {
          assert.equal(code, 4003);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
    sockets[0]!.send(new Uint8Array(1024 * 1024 + 1));
    await closed;
  } finally {
    for (const socket of sockets) socket.close();
  }
});

test('bounds room admission', { skip: !base || !process.env.DEMO_TEST_SECRET, timeout: 10000 }, async () => {
  const responses = await Promise.all(
    Array.from({ length: 13 }, () => fetch(`${base}/rooms`, { method: 'POST', headers: { Origin: origin } })),
  );
  assert.ok(responses.every((response) => response.status === 200 || response.status === 429));
  assert.ok(responses.some((response) => response.status === 429));
});
