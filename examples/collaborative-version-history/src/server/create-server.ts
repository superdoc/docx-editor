import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Hocuspocus } from '@hocuspocus/server';
import { applyUpdate, encodeStateAsUpdate } from 'yjs';
import { automaticLabel, createCheckpointScheduler, type CheckpointPolicy, type CheckpointScheduler } from './checkpoints.ts';
import { createRoomFiles, type RoomFileSystem } from './room-files.ts';
import { handleVersionRequest } from './routes.ts';
import { createFileVersionStore, type VersionStore } from './version-store.ts';
import { createVersionService, type ServerMarker, type VersionService } from './versions.ts';
import type { VersionSdkClient } from './sdk.ts';

export interface VersionServerOptions {
  port: number;
  host: string;
  dataDirectory: string;
  sourceDocx: string;
  checkpoints: CheckpointPolicy;
  versionStore?: VersionStore;
  createClient?: () => VersionSdkClient | Promise<VersionSdkClient>;
  debounceMs?: number;
  maxDebounceMs?: number;
  roomFileSystem?: RoomFileSystem;
}

export interface VersionServer {
  readonly hocuspocus: Hocuspocus;
  readonly versions: VersionService;
  readonly scheduler: CheckpointScheduler;
  readonly url: string;
  listen(): Promise<void>;
  stop(): Promise<void>;
}

const ROOM_NAME = /^sd2\/v[^/]+\/(.+)$/;

export const documentIdFromRoomName = (roomName: string) => ROOM_NAME.exec(roomName)?.[1] ?? null;

export function websocketUrl(host: string, port: number) {
  const reachable = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host;
  return `ws://${reachable.includes(':') ? `[${reachable}]` : reachable}:${port}`;
}

export function createVersionServer(options: VersionServerOptions): VersionServer {
  const marker: ServerMarker = { name: 'superdocVersionService', value: randomBytes(24).toString('hex') };
  const url = websocketUrl(options.host, options.port);
  const rooms = createRoomFiles(path.join(options.dataDirectory, 'rooms'), options.roomFileSystem);
  const versions = createVersionService({
    store: options.versionStore ?? createFileVersionStore(path.join(options.dataDirectory, 'versions')),
    serverUrl: url,
    marker,
    ...(options.createClient ? { createClient: options.createClient } : {}),
  });
  const scheduler = createCheckpointScheduler({
    policy: options.checkpoints,
    checkpoint: (documentId, trigger) =>
      versions.save(documentId, { label: automaticLabel(trigger), trigger, createdBy: 'Autosave' }),
  });
  let stopping: Promise<void> | undefined;

  const isService = (parameters: URLSearchParams) => parameters.get(marker.name) === marker.value;

  const hocuspocus = new Hocuspocus({
    port: options.port,
    address: options.host,
    quiet: true,
    stopOnSignals: false,
    ...(options.debounceMs === undefined ? {} : { debounce: options.debounceMs }),
    ...(options.maxDebounceMs === undefined ? {} : { maxDebounce: options.maxDebounceMs }),

    async onConnect({ requestParameters }) {
      const service = isService(requestParameters);
      if (stopping && !service) throw new Error('Server is shutting down.');
      return { isService: service };
    },

    async beforeHandleMessage({ connection, context }) {
      if (stopping && context?.isService !== true) connection.readOnly = true;
    },

    async onRequest({ request, response }) {
      const handled = await handleVersionRequest(request, response, {
        versions,
        scheduler,
        sourceDocx: async () => new Uint8Array(await readFile(options.sourceDocx)),
      });
      if (handled) throw null;
    },

    async onLoadDocument({ documentName, document }) {
      const state = await rooms.load(documentName);
      if (state) applyUpdate(document, state);
      return document;
    },

    async onStoreDocument({ documentName, document }) {
      await rooms.store(documentName, encodeStateAsUpdate(document));
    },

    async onChange({ documentName, context }) {
      const documentId = documentIdFromRoomName(documentName);
      if (documentId && context?.isService !== true) scheduler.roomChanged(documentId);
    },

    async onDisconnect({ documentName, clientsCount }) {
      const documentId = documentIdFromRoomName(documentName);
      if (documentId && clientsCount === 0) scheduler.roomEmptied(documentId);
    },
  });

  const unloadRegisteredRoom = hocuspocus.unloadDocument.bind(hocuspocus);
  // SD-5538: Hocuspocus 2.15.3 unloads by room name, so an old room's finished save would drop the room that replaced it.
  hocuspocus.unloadDocument = async (document) => {
    if (hocuspocus.documents.get(document.name) === document) await unloadRegisteredRoom(document);
  };

  return {
    hocuspocus,
    versions,
    scheduler,
    url,
    async listen() {
      await hocuspocus.listen();
    },
    stop() {
      stopping ??= (async () => {
        for (const document of hocuspocus.documents.values()) {
          for (const connection of document.getConnections()) {
            if (connection.context?.isService !== true) connection.readOnly = true;
          }
        }
        try {
          await scheduler.stop();
          await versions.dispose();
        } finally {
          await hocuspocus.destroy();
        }
      })();
      return stopping;
    },
  };
}
