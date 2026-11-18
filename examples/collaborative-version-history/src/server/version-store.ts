import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type CheckpointTrigger = 'named' | 'idle' | 'interval' | 'last-editor-left' | 'shutdown' | 'before-restore' | 'restore';

export interface VersionRecord {
  id: string;
  number: number;
  label: string;
  trigger: CheckpointTrigger;
  createdBy: string;
  createdAt: string;
  sha256: string;
  byteLength: number;
  restoredFrom?: string;
}

export interface NewVersion {
  docx: Uint8Array;
  label: string;
  trigger: CheckpointTrigger;
  createdBy: string;
  restoredFrom?: string;
}

export interface VersionStore {
  list(documentId: string): Promise<VersionRecord[]>;
  read(documentId: string, versionId: string): Promise<Uint8Array | null>;
  append(documentId: string, version: NewVersion, expectedHead: string | null): Promise<VersionRecord>;
}

export class StaleHeadError extends Error {
  constructor(
    readonly expectedHead: string | null,
    readonly actualHead: string | null,
  ) {
    super(`Expected the latest version to be ${expectedHead ?? 'none'}, but it is ${actualHead ?? 'none'}.`);
    this.name = 'StaleHeadError';
  }
}

export const headOf = (versions: VersionRecord[]): VersionRecord | null => versions.at(-1) ?? null;

export function createFileVersionStore(directory: string, now: () => Date = () => new Date()): VersionStore {
  let writes = 0;
  const folderFor = (documentId: string) =>
    path.join(directory, createHash('sha256').update(documentId).digest('hex'));
  const manifestFor = (documentId: string) => path.join(folderFor(documentId), 'versions.json');
  const blobFor = (documentId: string, versionId: string) => path.join(folderFor(documentId), `${versionId}.docx`);

  const writeAtomically = async (target: string, bytes: Uint8Array | string) => {
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${++writes}.tmp`;
    await writeFile(temporary, bytes);
    await rename(temporary, target);
  };

  const list = async (documentId: string): Promise<VersionRecord[]> => {
    try {
      return JSON.parse(await readFile(manifestFor(documentId), 'utf8')) as VersionRecord[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  };

  return {
    list,
    async read(documentId, versionId) {
      const versions = await list(documentId);
      if (!versions.some((version) => version.id === versionId)) return null;
      return new Uint8Array(await readFile(blobFor(documentId, versionId)));
    },
    async append(documentId, version, expectedHead) {
      const versions = await list(documentId);
      const head = headOf(versions);
      if ((head?.id ?? null) !== expectedHead) throw new StaleHeadError(expectedHead, head?.id ?? null);

      const number = (head?.number ?? 0) + 1;
      const record: VersionRecord = {
        id: `v${number}`,
        number,
        label: version.label,
        trigger: version.trigger,
        createdBy: version.createdBy,
        createdAt: now().toISOString(),
        sha256: createHash('sha256').update(version.docx).digest('hex'),
        byteLength: version.docx.byteLength,
        ...(version.restoredFrom === undefined ? {} : { restoredFrom: version.restoredFrom }),
      };
      await writeAtomically(blobFor(documentId, record.id), version.docx);
      await writeAtomically(manifestFor(documentId), JSON.stringify([...versions, record], null, 2));
      return record;
    },
  };
}
