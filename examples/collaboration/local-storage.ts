import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Configuration } from '@hocuspocus/server';
import { applyUpdate, encodeStateAsUpdate, type Doc } from 'yjs';

type RoomState = { document: Doc; documentName: string };

export function localStorage(directory: string) {
  mkdirSync(directory, { recursive: true });
  const filename = (name: string) => join(directory, `${createHash('sha256').update(name).digest('hex')}.yjs`);

  return {
    async onLoadDocument({ document, documentName }: RoomState) {
      let state: Buffer;
      try {
        state = readFileSync(filename(documentName));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      applyUpdate(document, state);
    },
    async onStoreDocument({ document, documentName }: RoomState) {
      const target = filename(documentName);
      // Synchronous writes serialize this single-process example; rename avoids exposing a partial snapshot.
      writeFileSync(`${target}.tmp`, encodeStateAsUpdate(document));
      renameSync(`${target}.tmp`, target);
      console.log('Room state saved.');
    },
  } satisfies Pick<Configuration, 'onLoadDocument' | 'onStoreDocument'>;
}
