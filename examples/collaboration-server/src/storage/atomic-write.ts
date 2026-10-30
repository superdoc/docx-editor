import { mkdir, rename, writeFile } from 'node:fs/promises';

export function createAtomicWriter(directory: string) {
  let ready: Promise<unknown> | undefined;
  let writes = 0;

  return async function writeFileAtomically(target: string, bytes: Uint8Array) {
    ready ??= mkdir(directory, { recursive: true });
    await ready;
    const temporary = `${target}.${process.pid}.${++writes}.tmp`;
    await writeFile(temporary, bytes);
    await rename(temporary, target);
  };
}
