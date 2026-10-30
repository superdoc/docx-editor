import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import type { TestContext } from 'node:test';
import { Doc } from 'yjs';
import type { Authorize } from '../src/auth/types.ts';
import type { DocxAutosave } from '../src/docx/autosave.ts';
import { createCollaborationServer } from '../src/create-server.ts';
import { createFileRoomStore } from '../src/storage/file.ts';
import type { RoomStore } from '../src/storage/types.ts';

export async function waitFor(condition: () => boolean, what: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export async function freePort() {
  const probe = createNetServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

export interface Client {
  document: Doc;
  pendingChanges(): number;
  leave(): void;
}

export interface TestServer {
  port: number;
  server: ReturnType<typeof createCollaborationServer>;
  clients: Client[];
}

export async function startServer(
  t: TestContext,
  options: {
    storageDirectory: string;
    roomStore?: RoomStore;
    authorize?: Authorize | null;
    docxAutosave?: DocxAutosave | null;
  },
): Promise<TestServer> {
  const port = await freePort();
  const server = createCollaborationServer({
    port,
    host: '127.0.0.1',
    roomStore: options.roomStore ?? createFileRoomStore(options.storageDirectory),
    authorize: options.authorize ?? null,
    docxAutosave: options.docxAutosave ?? null,
    debounceMs: 50,
    maxDebounceMs: 200,
  });
  await server.listen();
  const started: TestServer = { port, server, clients: [] };
  t.after(async () => {
    for (const client of started.clients) client.leave();
    await server.destroy();
  });
  return started;
}

export interface OpenOptions {
  token?: string;
  parameters?: Record<string, string>;
  waitMs?: number;
}

export async function open(server: Pick<TestServer, 'port' | 'clients'>, room: string, { token, parameters, waitMs = 5000 }: OpenOptions = {}) {
  const document = new Doc();
  let outcome: 'synced' | 'denied' | 'pending' | undefined;
  const socket = new HocuspocusProviderWebsocket({ url: `ws://127.0.0.1:${server.port}`, parameters: parameters ?? {} });
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: room,
    document,
    ...(token === undefined ? {} : { token }),
    onSynced: () => {
      outcome ??= 'synced';
    },
    onAuthenticationFailed: () => {
      outcome ??= 'denied';
    },
    onClose: ({ event }) => {
      if (event.code === 4401 || event.code === 4403) outcome ??= 'denied';
    },
  });
  const client: Client = {
    document,
    pendingChanges: () => provider.unsyncedChanges,
    leave() {
      provider.destroy();
      socket.destroy();
    },
  };
  server.clients.push(client);
  const deadline = Date.now() + waitMs;
  while (outcome === undefined && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  return { ...client, outcome: outcome ?? 'pending' };
}

export async function connect(server: Pick<TestServer, 'port' | 'clients'>, room: string, options: OpenOptions = {}): Promise<Client> {
  const opened = await open(server, room, options);
  if (opened.outcome !== 'synced') throw new Error(`Expected to sync ${room}, but access was ${opened.outcome}.`);
  return opened;
}
