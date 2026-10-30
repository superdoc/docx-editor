import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createAtomicWriter } from './atomic-write.ts';
import type { RoomStore } from './types.ts';

export function createFileRoomStore(directory: string): RoomStore {
  const writeFileAtomically = createAtomicWriter(directory);
  const hashedFileFor = (roomName: string) =>
    path.join(directory, `${createHash('sha256').update(roomName).digest('hex')}.yjs`);

  return {
    async load(roomName) {
      try {
        return new Uint8Array(await readFile(hashedFileFor(roomName)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    store: (roomName, state) => writeFileAtomically(hashedFileFor(roomName), state),
  };
}
