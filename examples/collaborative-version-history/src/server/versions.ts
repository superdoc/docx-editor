import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createDefaultSdkClient,
  errorCode,
  type DiffResult,
  type RoomTarget,
  type VersionDocument,
  type VersionSdkClient,
} from './sdk.ts';
import { headOf, type CheckpointTrigger, type VersionRecord, type VersionStore } from './version-store.ts';

export interface ServerMarker {
  name: string;
  value: string;
}

export interface VersionServiceOptions {
  store: VersionStore;
  serverUrl: string;
  marker: ServerMarker;
  createClient?: () => VersionSdkClient | Promise<VersionSdkClient>;
}

export interface SaveRequest {
  label: string;
  trigger: CheckpointTrigger;
  createdBy: string;
}

export interface RestoreRequest {
  versionId: string;
  baseVersionId: string | null;
  requestedBy: string;
}

export interface RestoreResult {
  before: VersionRecord;
  restored: VersionRecord;
}

export interface ComparisonResult {
  docx: Uint8Array;
  reviewItems: number;
}

export interface VersionService {
  list(documentId: string): Promise<VersionRecord[]>;
  read(documentId: string, versionId: string): Promise<Uint8Array | null>;
  save(documentId: string, request: SaveRequest): Promise<VersionRecord>;
  compare(documentId: string, fromId: string, toId: string): Promise<ComparisonResult>;
  restore(documentId: string, request: RestoreRequest): Promise<RestoreResult>;
  createRoomIfMissing(documentId: string, docx: Uint8Array): Promise<'created' | 'exists'>;
  dispose(): Promise<void>;
}

export class VersionNotFoundError extends Error {
  constructor(readonly versionId: string) {
    super(`Version ${versionId} does not exist.`);
    this.name = 'VersionNotFoundError';
  }
}

export type RestoreConflictReason = 'stale-base' | 'room-changed';

export class RestoreConflictError extends Error {
  constructor(
    readonly reason: RestoreConflictReason,
    readonly head: VersionRecord | null,
  ) {
    super(
      reason === 'stale-base'
        ? `A newer version (${head?.id ?? 'none'}) was saved. Review it before restoring.`
        : 'The document changed while restoring. Nothing was restored; try again.',
    );
    this.name = 'RestoreConflictError';
  }
}

export class ComparisonBlockedError extends Error {
  constructor(readonly blockers: Array<{ code: string; message: string }>) {
    super('These versions cannot be shown as tracked changes.');
    this.name = 'ComparisonBlockedError';
  }
}

export function createVersionService(options: VersionServiceOptions): VersionService {
  const { store } = options;
  const createClient = options.createClient ?? (() => createDefaultSdkClient('Version history'));
  let client: VersionSdkClient | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  const room = (documentId: string): RoomTarget => ({
    providerType: 'hocuspocus',
    url: options.serverUrl,
    documentId,
    roomMode: 'join',
    params: { [options.marker.name]: options.marker.value },
  });

  const exclusive = <T>(work: (sdk: VersionSdkClient, directory: string) => Promise<T>): Promise<T> => {
    const run = queue.then(async () => {
      const directory = await mkdtemp(path.join(tmpdir(), 'superdoc-versions-'));
      try {
        client ??= await createClient();
        return await work(client, directory);
      } catch (error) {
        if (!isExpected(error)) {
          await client?.dispose().catch(() => {});
          client = undefined;
        }
        throw error;
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
    queue = run.catch(() => {});
    return run;
  };

  const saveTo = async (document: VersionDocument, directory: string, name: string) => {
    const out = path.join(directory, `${name}.docx`);
    await document.save({ out, force: true });
    return new Uint8Array(await readFile(out));
  };

  const openFile = async (sdk: VersionSdkClient, directory: string, name: string, docx: Uint8Array) => {
    const file = path.join(directory, `${name}.docx`);
    await writeFile(file, docx);
    return sdk.open({ doc: file });
  };

  const readVersion = async (documentId: string, versionId: string) => {
    const docx = await store.read(documentId, versionId);
    if (!docx) throw new VersionNotFoundError(versionId);
    return docx;
  };

  const withDocument = async <T>(opened: Promise<VersionDocument>, work: (document: VersionDocument) => Promise<T>) => {
    const document = await opened;
    try {
      return await work(document);
    } finally {
      await document.close({ discard: true });
    }
  };

  const appendAtHead = async (documentId: string, docx: Uint8Array, request: SaveRequest, restoredFrom?: string) => {
    const head = headOf(await store.list(documentId));
    return store.append(
      documentId,
      { docx, ...request, ...(restoredFrom === undefined ? {} : { restoredFrom }) },
      head?.id ?? null,
    );
  };

  return {
    list: (documentId) => store.list(documentId),
    read: (documentId, versionId) => store.read(documentId, versionId),

    save: (documentId, request) =>
      exclusive(async (sdk, directory) => {
        const docx = await withDocument(sdk.open({ collaboration: room(documentId) }), (document) =>
          saveTo(document, directory, 'room'),
        );
        if (['idle', 'interval', 'last-editor-left', 'shutdown'].includes(request.trigger)) {
          const head = headOf(await store.list(documentId));
          if (head) {
            const previous = await store.read(documentId, head.id);
            if (previous && previous.length === docx.length && previous.every((byte, index) => byte === docx[index])) return head;
          }
        }
        return appendAtHead(documentId, docx, request);
      }),

    compare: (documentId, fromId, toId) =>
      exclusive(async (sdk, directory) => {
        const [from, to] = await Promise.all([readVersion(documentId, fromId), readVersion(documentId, toId)]);
        const targetSnapshot = await withDocument(openFile(sdk, directory, 'to', to), (document) =>
          document.diff.capture({}),
        );
        return withDocument(openFile(sdk, directory, 'from', from), async (document) => {
          const diff = await document.diff.compare({ targetSnapshot });
          const eligibility = diff.applyEligibility?.tracked;
          if (eligibility && eligibility.status !== 'candidate') throw new ComparisonBlockedError(eligibility.blockers);
          const receipt = await document.diff.apply({ diff, changeMode: 'tracked' });
          const reviewItems = receipt.operationReceipts.reduce(
            (count: number, item: { reviewItems: unknown[] }) => count + item.reviewItems.length,
            0,
          );
          return { docx: await saveTo(document, directory, 'comparison'), reviewItems };
        });
      }),

    restore: (documentId, request) =>
      exclusive(async (sdk, directory) => {
        const head = headOf(await store.list(documentId));
        if ((head?.id ?? null) !== request.baseVersionId) throw new RestoreConflictError('stale-base', head);
        const target = await readVersion(documentId, request.versionId);
        const targetSnapshot = await withDocument(openFile(sdk, directory, 'target', target), (document) =>
          document.diff.capture({}),
        );

        return withDocument(sdk.open({ collaboration: room(documentId) }), async (document) => {
          const diff = await document.diff.compare({ targetSnapshot });
          assertDirectlyApplicable(diff);
          const before = await appendAtHead(documentId, await saveTo(document, directory, 'before'), {
            label: `Before restoring ${request.versionId}`,
            trigger: 'before-restore',
            createdBy: request.requestedBy,
          });
          if (diff.summary.hasChanges) {
            try {
              await document.diff.apply({ diff, changeMode: 'direct' });
            } catch (error) {
              if (errorCode(error) === 'PRECONDITION_FAILED') throw new RestoreConflictError('room-changed', before);
              throw error;
            }
          }
          const restored = await appendAtHead(
            documentId,
            await saveTo(document, directory, 'restored'),
            { label: `Restored ${request.versionId}`, trigger: 'restore', createdBy: request.requestedBy },
            request.versionId,
          );
          return { before, restored };
        });
      }),

    createRoomIfMissing: (documentId, docx) =>
      exclusive(async (sdk, directory) => {
        const file = path.join(directory, 'source.docx');
        await writeFile(file, docx);
        try {
          await withDocument(sdk.open({ doc: file, collaboration: { ...room(documentId), roomMode: 'create' } }), async () => {});
          return 'created';
        } catch (error) {
          if (errorCode(error) === 'COLLABORATION_ROOM_ALREADY_EXISTS') return 'exists';
          throw error;
        }
      }),

    async dispose() {
      await queue;
      await client?.dispose();
      client = undefined;
    },
  };
}

function assertDirectlyApplicable(diff: DiffResult) {
  const eligibility = diff.applyEligibility?.direct;
  if (eligibility && eligibility.status !== 'candidate') throw new ComparisonBlockedError(eligibility.blockers);
}

function isExpected(error: unknown) {
  return (
    errorCode(error) === 'COLLABORATION_ROOM_ALREADY_EXISTS' ||
    error instanceof VersionNotFoundError ||
    error instanceof RestoreConflictError ||
    error instanceof ComparisonBlockedError
  );
}
