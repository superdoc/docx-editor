import type { ChangeRecord, StoryLocator } from '@superdoc/document-api';
import { isPlainObject } from '../../helpers/object-guards.js';
import type { SuperDocDocumentChange } from './types.js';

type RemoteDocumentChangeFacts = Omit<SuperDocDocumentChange, 'documentEpoch' | 'seq'>;

function isRemoteChangeRecord(value: unknown): value is ChangeRecord {
  return isPlainObject(value) && value.origin === 'remote' && Array.isArray(value.changes);
}

export function remoteChangeRecordsOf(event: Record<string, unknown>): ChangeRecord[] {
  if (event.type !== 'changes:recorded' || !Array.isArray(event.records)) return [];
  return event.records.filter(isRemoteChangeRecord);
}

export function storiesOfChangeRecords(records: readonly ChangeRecord[]): StoryLocator[] {
  const stories = new Map<string, StoryLocator>();
  for (const record of records) {
    for (const change of record.changes) {
      if (change.kind === 'sidecar' || !isPlainObject(change.story)) continue;
      const key = JSON.stringify(change.story);
      if (!stories.has(key)) stories.set(key, change.story);
    }
  }
  return [...stories.values()];
}

function sharedChangeTag(records: readonly ChangeRecord[]): string | null {
  const tags = new Set(records.map((record) => record.changeTag ?? null));
  const [tag] = tags;
  return tags.size === 1 && typeof tag === 'string' ? tag : null;
}

export function remoteDocumentChange(records: readonly ChangeRecord[]): RemoteDocumentChangeFacts {
  if (records.length === 0) return { cause: 'remote', changeTag: null, txId: null, scope: { kind: 'unknown' } };
  const stories = storiesOfChangeRecords(records);
  return {
    cause: 'remote',
    changeTag: sharedChangeTag(records),
    txId: null,
    scope: stories.length > 0 ? { kind: 'known', stories } : { kind: 'unknown' },
    records: [...records],
  };
}
