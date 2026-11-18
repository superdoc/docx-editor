import { Hocuspocus, type DirectConnection, type Document } from '@hocuspocus/server';
import { applyUpdate, encodeStateAsUpdate } from 'yjs';
import type { Authorize } from './auth/types.ts';
import type { DocxAutosave } from './docx/types.ts';
import { documentIdFromRoomName } from './room-name.ts';
import type { RoomStore } from './storage/types.ts';

export interface CollaborationServerOptions {
  port: number;
  host: string;
  roomStore: RoomStore;
  authorize: Authorize | null;
  docxAutosave: DocxAutosave | null;
  debounceMs?: number;
  maxDebounceMs?: number;
}

export type CollaborationServer = Hocuspocus & {
  stop(): Promise<void>;
  deleteRoom(roomName: string): Promise<void>;
};

const ROOM_DELETED_CLOSE = { code: 4403, reason: 'Room deleted.' };

interface RoomAdmission {
  isAutosave: boolean;
  roomGeneration: number;
  storageGeneration: string | undefined;
}

interface AdmissionContext {
  superdocRoomAdmission?: Promise<RoomAdmission>;
}

export function createCollaborationServer(options: CollaborationServerOptions): CollaborationServer {
  const { authorize, docxAutosave, roomStore } = options;
  const roomWrites = new Map<string, Promise<Uint8Array>>();
  const deletions = new Map<string, Promise<void>>();
  const roomGenerations = new Map<string, number>();
  const roomGeneration = (roomName: string) => roomGenerations.get(roomName) ?? 0;
  const deletedDocuments = new WeakSet<Document>();
  const storedGenerations = new WeakMap<Document, string>();
  const initialStoredDocuments = new WeakSet<Document>();
  let synchronizing = false;
  let shuttingDown = false;
  let shutdown: Promise<void> | undefined;

  const matchesAdmission = (admitted: unknown, generation: string, initialGeneration: boolean) =>
    admitted === generation || admitted === '' && initialGeneration;

  const loadedAdmissionGeneration = (document: Document, admitted: unknown) => {
    const generation = storedGenerations.get(document);
    if (roomStore.coordination && (deletedDocuments.has(document) || generation === undefined || !matchesAdmission(admitted, generation, initialStoredDocuments.has(document)))) throw new Error('Room was reset.');
    return generation;
  };

  const readAdmission = async (documentName: string, requestParameters: URLSearchParams): Promise<RoomAdmission> => {
    const generation = roomGeneration(documentName);
    if (deletions.has(documentName)) throw new Error('Room is being deleted.');
    const isAutosave = docxAutosave !== null && requestParameters.get(docxAutosave.marker.name) === docxAutosave.marker.value;
    if (shuttingDown && !isAutosave) throw new Error('Server is shutting down.');
    const stored = await roomStore.coordination?.read(documentName);
    const requestedGeneration = requestParameters.get('sdRoomGeneration');
    if (stored && requestedGeneration !== null && !matchesAdmission(requestedGeneration, stored.generation, stored.initialGeneration)) throw new Error('Room was reset.');
    const loaded = server.documents.get(documentName);
    if (stored && loaded && !loaded.isLoading && storedGenerations.get(loaded) !== stored.generation) {
      const current = await roomStore.coordination?.read(documentName);
      if (current && server.documents.get(documentName) === loaded && storedGenerations.get(loaded) !== current.generation) {
        deletedDocuments.add(loaded);
        docxAutosave?.roomDeleted(documentName);
        await unloadDeletedDocument(documentName, loaded);
      }
    }
    return { isAutosave, roomGeneration: generation, storageGeneration: stored?.generation };
  };

  const admissionFor = (context: AdmissionContext, documentName: string, parameters: URLSearchParams) =>
    context.superdocRoomAdmission ??= readAdmission(documentName, parameters);

  const loadStoredState = async (roomName: string, document: Document) => {
    const coordination = roomStore.coordination;
    if (!coordination) return;
    const stored = await coordination.read(roomName);
    if (deletedDocuments.has(document) || server.documents.get(roomName) !== document) throw new Error('Room was reset.');
    if (storedGenerations.get(document) !== stored.generation) {
      deletedDocuments.add(document);
      docxAutosave?.roomDeleted(roomName);
      await disconnectDirectConnections(roomName);
      for (const connection of document.getConnections()) connection.close(ROOM_DELETED_CLOSE);
      throw new Error('Room was reset.');
    }
    if (stored.state) applyUpdate(document, stored.state);
  };

  const storeDocument = async (roomName: string, document: Document) => {
    if (deletedDocuments.has(document)) throw new Error('Room was deleted.');
    const previous = roomWrites.get(roomName)?.catch(() => {}) ?? Promise.resolve();
    const write = previous.then(async () => {
      if (deletedDocuments.has(document)) throw new Error('Room was deleted.');
      const generation = storedGenerations.get(document);
      if (roomStore.coordination) {
        if (generation === undefined) throw new Error('A coordinated room needs a loaded storage generation.');
        const stored = await roomStore.coordination.commit(roomName, generation, encodeStateAsUpdate(document));
        if (!stored.state) throw new Error('The store did not return the committed room state.');
        applyUpdate(document, stored.state);
        return stored.state;
      } else {
        const state = encodeStateAsUpdate(document);
        await roomStore.store(roomName, state);
        return state;
      }
    });
    roomWrites.set(roomName, write);
    try { return await write; } finally { if (roomWrites.get(roomName) === write) roomWrites.delete(roomName); }
  };

  const server: Hocuspocus = new Hocuspocus({
    port: options.port,
    address: options.host,
    quiet: true,
    stopOnSignals: false,
    extensions: [
      {
        async beforeUnloadDocument({ documentName }) {
          for (let write = roomWrites.get(documentName); write; write = roomWrites.get(documentName)) {
            await write.catch(() => {});
          }
        },
      },
    ],
    ...(roomStore.coordination ? { debounce: 0, maxDebounce: 0 } : {}),
    ...(options.debounceMs === undefined ? {} : { debounce: options.debounceMs }),
    ...(options.maxDebounceMs === undefined ? {} : { maxDebounce: options.maxDebounceMs }),

    async onConnect({ documentName, requestParameters, context }) {
      return admissionFor(context, documentName, requestParameters);
    },

    async connected({ connectionInstance, context }) {
      try {
        const generation = loadedAdmissionGeneration(connectionInstance.document, context?.storageGeneration);
        if (generation !== undefined) context.storageGeneration = generation;
      } catch { connectionInstance.close(ROOM_DELETED_CLOSE); return; }
      if (typeof context?.storageGeneration === 'string') {
        connectionInstance.sendStateless(JSON.stringify({ protocol: 'superdoc-room-storage-v1', generation: context.storageGeneration }));
      }
    },

    async onStateless({ connection, documentName, document, payload }) {
      let message: unknown;
      try { message = JSON.parse(payload); } catch { return; }
      if (!message || typeof message !== 'object' || !('protocol' in message) || message.protocol !== 'superdoc-room-storage-v1') return;
      if (!('id' in message) || typeof message.id !== 'string' || message.id.length > 100 || !('action' in message)) return;
      if (message.action !== 'initial' && message.action !== 'commit') return;
      const { id, action } = message;
      try {
        await loadStoredState(documentName, document);
        const state = action === 'commit' ? await storeDocument(documentName, document) : encodeStateAsUpdate(document);
        connection.sendStateless(JSON.stringify({ protocol: 'superdoc-room-storage-v1', id, action, stored: action === 'commit', state: Buffer.from(state).toString('base64') }));
      } catch {
        connection.sendStateless(JSON.stringify({ protocol: 'superdoc-room-storage-v1', id, action, error: 'STORAGE_FAILED' }));
      }
    },

    async beforeHandleMessage({ connection, context, documentName, document }) {
      if (context?.roomGeneration !== roomGeneration(documentName)) throw new Error('Room was deleted.');
      if (deletedDocuments.has(document)) throw new Error('Room was deleted.');
      const generation = loadedAdmissionGeneration(document, context?.storageGeneration);
      if (generation !== undefined) context.storageGeneration = generation;
      if (shuttingDown && context?.isAutosave !== true) connection.readOnly = true;
    },

    ...(authorize && {
      async onAuthenticate({ token, documentName, connection, requestParameters, context }) {
        const admission = await admissionFor(context, documentName, requestParameters);
        const access = await authorize({
          token,
          roomName: documentName,
          documentId: documentIdFromRoomName(documentName),
        });
        if (!access) throw new Error('Access denied.');
        if (
          shuttingDown &&
          (!docxAutosave || requestParameters.get(docxAutosave.marker.name) !== docxAutosave.marker.value)
        ) {
          throw new Error('Server is shutting down.');
        }
        if (access.readOnly) connection.readOnly = true;
        return { ...admission, userId: access.userId };
      },
    }),

    async onLoadDocument({ documentName, document, context }) {
      if (context?.roomGeneration !== roomGeneration(documentName)) throw new Error('Room was deleted.');
      const existing = await roomStore.coordination?.read(documentName);
      if (existing && !matchesAdmission(context?.storageGeneration, existing.generation, existing.initialGeneration)) throw new Error('Room was reset.');
      const stored = await roomStore.coordination?.open(documentName);
      if (stored && !matchesAdmission(context?.storageGeneration, stored.generation, stored.initialGeneration)) throw new Error('Room was reset.');
      if (stored) {
        storedGenerations.set(document, stored.generation);
        if (stored.initialGeneration) initialStoredDocuments.add(document);
        context.storageGeneration = stored.generation;
      }
      const state = stored ? stored.state : await roomStore.load(documentName);
      if (state) applyUpdate(document, state);
      return document;
    },

    async onStoreDocument({ documentName, document }) {
      if (deletedDocuments.has(document)) return;
      await storeDocument(documentName, document);
    },

    async onDestroy() { shuttingDown = true; clearInterval(synchronization); },

    ...(docxAutosave && {
      async onChange({ documentName, document, context }) {
        if (context?.isAutosave !== true && !deletedDocuments.has(document)) docxAutosave.roomChanged(documentName);
      },
      async onDisconnect({ documentName, document, clientsCount }) {
        if (clientsCount === 0 && !deletedDocuments.has(document)) docxAutosave.roomEmptied(documentName);
      },
    }),
  });

  const synchronization = roomStore.coordination ? setInterval(() => {
    if (synchronizing || shuttingDown) return;
    synchronizing = true;
    void Promise.all([...server.documents].map(async ([name, document]) => {
      if (document.isLoading || deletedDocuments.has(document)) return;
      await loadStoredState(name, document);
    })).catch(() => {}).finally(() => { synchronizing = false; });
  }, 50) : undefined;
  synchronization?.unref();

  const directConnections = new Map<string, Set<DirectConnection>>();
  const openDirectConnection = server.openDirectConnection.bind(server);
  server.openDirectConnection = async (documentName: string, context?: unknown) => {
    if (deletions.has(documentName)) throw new Error('Room is being deleted.');
    const connection = await openDirectConnection(documentName, {
      ...(typeof context === 'object' && context !== null ? context : {}),
      roomGeneration: roomGeneration(documentName),
      storageGeneration: (await roomStore.coordination?.read(documentName))?.generation,
    });
    if (deletions.has(documentName)) {
      await connection.disconnect();
      throw new Error('Room is being deleted.');
    }
    const open = directConnections.get(documentName) ?? new Set<DirectConnection>();
    directConnections.set(documentName, open);
    open.add(connection);
    const disconnect = connection.disconnect.bind(connection);
    connection.disconnect = async () => {
      open.delete(connection);
      if (open.size === 0 && directConnections.get(documentName) === open) directConnections.delete(documentName);
      await disconnect();
    };
    return connection;
  };

  const disconnectDirectConnections = async (roomName: string) => {
    const open = [...(directConnections.get(roomName) ?? [])];
    await Promise.all(open.map((connection) => connection.disconnect()));
  };

  const unloadDeletedDocument = async (roomName: string, document: Document) => {
    const storeHook = `onStoreDocument-${roomName}`;
    while (server.documents.get(roomName) === document) {
      if (server.debouncer.isDebounced(storeHook)) await server.debouncer.executeNow(storeHook);
      else if (document.getConnectionsCount() === 0) await server.unloadDocument(document);
      else {
        await disconnectDirectConnections(roomName);
        for (const connection of document.getConnections()) connection.close(ROOM_DELETED_CLOSE);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
  };

  const deleteRoom = async (roomName: string) => {
    await server.loadingDocuments.get(roomName)?.catch(() => {});
    const document = server.documents.get(roomName);
    if (document) {
      deletedDocuments.add(document);
      await unloadDeletedDocument(roomName, document);
    }
    for (let write = roomWrites.get(roomName); write; write = roomWrites.get(roomName)) {
      await write.catch(() => {});
    }
    await roomStore.delete(roomName);
    docxAutosave?.roomDeleted(roomName);
  };

  return Object.assign(server, {
    deleteRoom(roomName: string) {
      const running = deletions.get(roomName);
      if (running) return running;
      roomGenerations.set(roomName, roomGeneration(roomName) + 1);
      const deletion = deleteRoom(roomName).finally(() => deletions.delete(roomName));
      deletions.set(roomName, deletion);
      return deletion;
    },
    stop() {
      if (!shutdown) {
        shuttingDown = true;
        for (const document of server.documents.values()) {
          for (const connection of document.getConnections()) {
            if (connection.context?.isAutosave !== true) connection.readOnly = true;
          }
        }
        shutdown = (async () => {
          try {
            await docxAutosave?.stop();
          } finally {
            await server.destroy();
          }
        })();
      }
      return shutdown;
    },
  });
}
