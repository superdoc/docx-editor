import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { Server } from '@hocuspocus/server';
import Fastify from 'fastify';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';

type Room = { creatorId: string; name: string; ready: boolean; lastOpened: string };

const port = Number(process.env.PORT ?? 3101);
const rooms = new Map<string, Room>();
const snapshots = new Map<string, Uint8Array>();
const collaboration = Server.configure({
  async onLoadDocument({ documentName, document }) {
    const snapshot = snapshots.get(documentName);
    if (snapshot) Y.applyUpdate(document, snapshot);
    return document;
  },
  async onChange({ documentName, document }) {
    commitRoom(documentName, document);
  },
  async onStoreDocument({ documentName, document }) {
    commitRoom(documentName, document);
  },
});

function commitRoom(documentName: string, document: Y.Doc) {
  snapshots.set(documentName, Y.encodeStateAsUpdate(document));
  const roomId = documentName.match(/^sd2\/v2\.1\/(.+)$/)?.[1];
  const room = roomId ? rooms.get(roomId) : undefined;
  if (!room) return;
  room.ready = true;
  room.lastOpened = new Date().toISOString();
}

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await app.register(fastifyStatic, {
  root: join(dirname(fileURLToPath(import.meta.url)), '../dist'),
  wildcard: false,
});

app.get<{ Params: { roomId: string } }>('/room/:roomId', async (_request, reply) => reply.sendFile('index.html'));

app.get('/api/rooms', async () =>
  [...rooms.entries()]
    .filter(([, room]) => room.ready)
    .map(([id, room]) => ({ id, name: room.name, lastOpened: room.lastOpened }))
    .sort((left, right) => right.lastOpened.localeCompare(left.lastOpened)),
);

// The server authorizes whether this room must be created or joined; the client
// executes that decision because SuperDoc seeds and opens v2 rooms in the browser.
app.post<{ Params: { roomId: string }; Querystring: { clientId?: string; name?: string } }>(
  '/api/rooms/:roomId/open',
  async (request, reply) => {
    const { roomId } = request.params;
    const clientId = request.query.clientId ?? '';
    const name = request.query.name?.trim() || 'Untitled document';
    const room = rooms.get(roomId);

    if (room && !room.ready && room.creatorId !== clientId) {
      return reply.code(409).send({ message: 'Room is still being created' });
    }

    const mode = !room || !room.ready ? 'create' : 'join';
    if (!room) {
      rooms.set(roomId, { creatorId: clientId, name, ready: false, lastOpened: new Date().toISOString() });
    } else if (room.ready) {
      room.lastOpened = new Date().toISOString();
    }

    return { mode, name: room?.name ?? name };
  },
);

app.post<{ Params: { roomId: string }; Querystring: { name?: string } }>(
  '/api/rooms/:roomId/rename',
  async (request, reply) => {
    const room = rooms.get(request.params.roomId);
    if (!room) return reply.code(404).send({ message: 'Room not found' });
    const name = request.query.name?.trim();
    if (!name) return reply.code(400).send({ message: 'Document name is required' });
    room.name = name;
    return { id: request.params.roomId, name };
  },
);

const webSockets = new WebSocketServer({ server: app.server });
webSockets.on('connection', (socket, request) => {
  socket.on('error', (error) => app.log.error(error));
  collaboration.handleConnection(socket, request);
});

await app.listen({ port, host: '0.0.0.0' });
