import { YServer } from 'y-partyserver';
import type { Connection, ConnectionContext, WSMessage } from 'partyserver';
import { applyUpdate, encodeStateAsUpdate } from 'yjs';
import { authorizeRoom, issueRoom } from './room-access';

interface RateLimiter {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}
interface Env {
  ROOMS: DurableObjectNamespace<CollaborationRoom>;
  ROOM_SECRET: string;
  ALLOWED_ORIGINS: string;
  ADMISSION: RateLimiter;
  TOTAL_ADMISSION: RateLimiter;
}

const MAX_MESSAGE_BYTES = 1024 * 1024;
const MAX_ROOM_BYTES = 16 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 1024 * 1024;

export class CollaborationRoom extends YServer<Env> {
  static options = { hibernate: false };
  private receivedBytes = 0;
  private messageWindow = 0;
  private messageCount = 0;
  private expired = false;
  private changed = false;

  private get expiresAt(): number {
    return Number(this.name.split('-')[1]);
  }

  async onLoad(): Promise<void> {
    if (Date.now() >= this.expiresAt) {
      this.expired = true;
      await this.ctx.storage.deleteAll();
      return;
    }
    this.expired = (await this.ctx.storage.get<boolean>('closed')) ?? false;
    if (this.expired) return;
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS document (id INTEGER PRIMARY KEY, snapshot BLOB NOT NULL)');
    const saved = this.ctx.storage.sql
      .exec<{ snapshot: ArrayBuffer }>('SELECT snapshot FROM document WHERE id = 1')
      .toArray()[0];
    if (saved) applyUpdate(this.document, new Uint8Array(saved.snapshot));
    this.receivedBytes = (await this.ctx.storage.get<number>('receivedBytes')) ?? 0;
    this.document.on('update', () => {
      this.changed = true;
    });
    await this.ctx.storage.setAlarm(this.expiresAt);
  }

  onConnect(connection: Connection, context: ConnectionContext): void {
    if (this.expired || Date.now() >= this.expiresAt) {
      connection.close(4001, 'Room expired');
      return;
    }
    if (Array.from(this.getConnections()).length > 4) {
      connection.close(4002, 'Room full');
      return;
    }
    super.onConnect(connection, context);
  }

  async onMessage(connection: Connection, message: WSMessage): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      if (this.expired) {
        connection.close(4001, 'Room closed');
        return;
      }
      if (Date.now() >= this.expiresAt) {
        await this.onAlarm();
        return;
      }
      const size = typeof message === 'string' ? Infinity : message.byteLength;
      const second = Math.floor(Date.now() / 1000);
      if (second !== this.messageWindow) {
        this.messageWindow = second;
        this.messageCount = 0;
      }
      if (size > MAX_MESSAGE_BYTES || ++this.messageCount > 120) {
        connection.close(4003, 'Message limit');
        return;
      }
      this.receivedBytes += size;
      if (this.receivedBytes > MAX_ROOM_BYTES) {
        this.expired = true;
        for (const peer of this.getConnections()) peer.close(4003, 'Room limit');
        await this.ctx.storage.put('closed', true);
        this.ctx.storage.sql.exec('DELETE FROM document');
        return;
      }
      this.changed = false;
      super.onMessage(connection, message);
      if (this.changed) {
        const snapshot = encodeStateAsUpdate(this.document);
        if (snapshot.byteLength > MAX_DOCUMENT_BYTES) {
          this.expired = true;
          for (const peer of this.getConnections()) peer.close(4003, 'Document limit');
          await this.ctx.storage.put('closed', true);
          this.ctx.storage.sql.exec('DELETE FROM document');
          return;
        }
        this.ctx.storage.sql.exec('INSERT OR REPLACE INTO document (id, snapshot) VALUES (1, ?)', snapshot);
      }
      await this.ctx.storage.put('receivedBytes', this.receivedBytes);
    });
  }

  async onAlarm(): Promise<void> {
    this.expired = true;
    for (const connection of this.getConnections()) connection.close(4001, 'Room expired');
    this.document.destroy();
    await this.ctx.storage.deleteAll();
  }

  onRequest(): Response {
    return new Response('Not found', { status: 404 });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') ?? '';
    const allowed = env.ALLOWED_ORIGINS.split(',').includes(origin);
    const headers = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Cache-Control': 'no-store' };
    if (!allowed) return new Response('Forbidden', { status: 403 });
    if (!env.ROOM_SECRET) return new Response('Demo unavailable', { status: 503, headers });
    if (url.pathname === '/rooms' && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'POST' } });
    }
    if (url.pathname === '/rooms' && request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
      if (
        !(await env.ADMISSION.limit({ key: ip })).success ||
        !(await env.TOTAL_ADMISSION.limit({ key: 'rooms' })).success
      ) {
        return new Response('Demo busy. Try again shortly.', { status: 429, headers });
      }
      return Response.json(await issueRoom(env.ROOM_SECRET), { headers });
    }
    if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Not found', { status: 404, headers });
    }
    const room = await authorizeRoom(url, env.ROOM_SECRET);
    if (!room) return new Response('Room expired or invalid', { status: 403, headers });
    // Validate before creating an object; untrusted room names must not allocate storage.
    const forwarded = new Request(request);
    forwarded.headers.delete('x-partykit-props');
    return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(forwarded);
  },
} satisfies ExportedHandler<Env>;
