import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface RoomFiles {
  load(roomName: string): Promise<Uint8Array | null>;
  store(roomName: string, state: Uint8Array): Promise<void>;
}

export interface RoomFileSystem {
  writeFile(file: string, bytes: Uint8Array): Promise<void>;
}

export function createRoomFiles(directory: string, fileSystem: RoomFileSystem = { writeFile }): RoomFiles {
  const pendingWrites = new Map<string, Promise<void>>();
  let writes = 0;

  const roomFile = (roomName: string) =>
    path.join(directory, `${createHash('sha256').update(roomName).digest('hex')}.yjs`);

  const writesSettled = async (roomName: string) => {
    for (let pending = pendingWrites.get(roomName); pending; pending = pendingWrites.get(roomName)) {
      await pending.catch(() => {});
    }
  };

  return {
    async load(roomName) {
      await writesSettled(roomName);
      try {
        return new Uint8Array(await readFile(roomFile(roomName)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },

    async store(roomName, state) {
      const previous = pendingWrites.get(roomName)?.catch(() => {}) ?? Promise.resolve();
      const write = previous.then(async () => {
        await mkdir(directory, { recursive: true });
        const target = roomFile(roomName);
        const temporary = `${target}.${process.pid}.${++writes}.tmp`;
        await fileSystem.writeFile(temporary, state);
        await rename(temporary, target);
      });
      pendingWrites.set(roomName, write);
      try {
        await write;
      } finally {
        if (pendingWrites.get(roomName) === write) pendingWrites.delete(roomName);
      }
    },
  };
}
