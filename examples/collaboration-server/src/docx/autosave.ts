import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { documentIdFromRoomName } from '../room-name.ts';
import { createDefaultSdkClient, withToken, type SdkClient } from '../sdk.ts';
import type { DocxStore } from '../storage/types.ts';

export interface DocxAutosaveOptions {
  serverUrl: string;
  docxStore: DocxStore;
  token?: () => string | Promise<string>;
  idleMs?: number;
  retries?: number;
  retryDelayMs?: number;
  createClient?: () => SdkClient;
  log?: (message: string) => void;
}

export interface DocxAutosave {
  readonly marker: { name: string; value: string };
  roomChanged(roomName: string): void;
  roomEmptied(roomName: string): void;
  flush(): Promise<void>;
  stop(): Promise<void>;
}

export function createDocxAutosave(options: DocxAutosaveOptions): DocxAutosave {
  const idleMs = options.idleMs ?? 10_000;
  const retries = options.retries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 2_000;
  const createClient = options.createClient ?? (() => createDefaultSdkClient('DOCX autosave'));
  const log = options.log ?? ((message: string) => console.log(message));
  const marker = { name: 'superdocAutosave', value: randomBytes(24).toString('hex') };

  const dirty = new Set<string>();
  const timers = new Map<string, NodeJS.Timeout>();
  const queue: string[] = [];
  const failures = new Map<string, unknown>();
  let running: Promise<void> | null = null;
  let client: SdkClient | undefined;
  let flushing = 0;
  let stopped = false;
  let stopping: Promise<void> | undefined;

  const enqueue = (roomName: string) => {
    clearTimeout(timers.get(roomName));
    timers.delete(roomName);
    if (!queue.includes(roomName)) queue.push(roomName);
    running ??= drain().finally(() => {
      running = null;
      if (queue.length > 0) enqueue(queue[0]!);
    });
  };

  const drain = async () => {
    while (queue.length > 0) {
      const roomName = queue.shift()!;
      dirty.delete(roomName);
      failures.delete(roomName);
      await saveWithRetries(roomName);
    }
  };

  const saveWithRetries = async (roomName: string) => {
    const documentId = documentIdFromRoomName(roomName);
    if (documentId === null) return log(`Not a SuperDoc room, skipping DOCX autosave: ${roomName}`);

    for (let attempt = 0; ; attempt += 1) {
      try {
        await saveOnce(documentId);
        return log(`Saved ${documentId}.docx`);
      } catch (error) {
        await client?.dispose().catch(() => {});
        client = undefined;
        const reason = error instanceof Error ? error.message : String(error);
        if (attempt >= retries) {
          dirty.add(roomName);
          failures.set(roomName, error);
          return log(`Could not save ${documentId}.docx: ${reason}. It will be saved after the next change.`);
        }
        log(`Saving ${documentId}.docx failed (${reason}). Retrying.`);
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
      }
    }
  };

  const saveOnce = async (documentId: string) => {
    client ??= createClient();
    const token = await options.token?.();
    const directory = await mkdtemp(path.join(tmpdir(), 'superdoc-autosave-'));
    try {
      const document = await client.open(
        {
          collaboration: {
            providerType: 'hocuspocus',
            url: options.serverUrl,
            documentId,
            roomMode: 'join',
            params: { [marker.name]: marker.value },
          },
        },
        withToken(token),
      );
      try {
        const out = path.join(directory, 'document.docx');
        await document.save({ out, force: true });
        await options.docxStore.put(documentId, new Uint8Array(await readFile(out)));
      } finally {
        await document.close({ discard: true });
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };

  const flush = async () => {
    flushing += 1;
    try {
      for (const roomName of dirty) enqueue(roomName);
      while (running) await running;
      if (failures.size > 0) {
        throw new AggregateError(failures.values(), `Could not save DOCX rooms: ${[...failures.keys()].join(', ')}`);
      }
    } finally {
      flushing -= 1;
    }
  };

  return {
    marker,
    roomChanged(roomName) {
      dirty.add(roomName);
      clearTimeout(timers.get(roomName));
      if (flushing > 0) enqueue(roomName);
      else timers.set(roomName, setTimeout(() => enqueue(roomName), idleMs));
    },
    roomEmptied(roomName) {
      if (!stopped && dirty.has(roomName)) enqueue(roomName);
    },
    flush,
    stop() {
      stopping ??= (async () => {
        try {
          await flush();
        } finally {
          stopped = true;
          await client?.dispose();
          client = undefined;
        }
      })();
      return stopping;
    },
  };
}
