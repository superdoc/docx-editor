import type { DocumentApi } from 'superdoc/ui';

type ChangesListInput = NonNullable<Parameters<DocumentApi['changes']['list']>[0]>;
type ChangesListResult = Awaited<ReturnType<DocumentApi['changes']['list']>>;
type ChangeRecord = ChangesListResult['items'][number];
type BlockChange = ChangeRecord['changes'][number];
type ChangesResolveResult = Awaited<ReturnType<DocumentApi['changes']['resolve']>>;
type ChangesActorsResult = Awaited<ReturnType<DocumentApi['changes']['actors']>>;
type ChangesSnapshotResult = Awaited<ReturnType<DocumentApi['changes']['snapshot']>>;

declare const doc: DocumentApi;

async function readChanges(): Promise<void> {
  const input: ChangesListInput = {
    after: '12',
    limit: 100,
    story: { kind: 'story', storyType: 'body' },
    blockId: 'p1',
    actorId: 'user-ada',
    includeUpdate: true,
    waitMs: 5000,
  };
  const listed: ChangesListResult = await doc.changes.list(input);
  const cursor: string | null = listed.cursor;
  const truncated: boolean = listed.truncated;
  const identity: 'configured' | 'missing' = listed.identity;
  const collaboration: boolean = listed.collaboration;
  for (const record of listed.items) {
    const id: string = record.id;
    const seq: number = record.seq;
    const actorId: string | null | undefined = record.actor?.id;
    const actorType: 'human' | 'code' | null = record.actorType;
    const changeTag: string | undefined = record.changeTag;
    for (const change of record.changes) {
      const entry: BlockChange = change;
      if (entry.kind === 'text') {
        const range: { start: number; end: number } = entry.range;
        const deleted: string = entry.deleted;
        void [range, deleted];
      } else if (entry.kind === 'sidecar') {
        const ids: string[] = entry.ids;
        const affects: 'comment' | 'trackedChange' | 'bookmark' = entry.affects;
        void [ids, affects];
      }
    }
    void [id, seq, actorId, actorType, changeTag];
  }
  await doc.changes.list();

  const found: ChangeRecord | null = await doc.changes.get({ id: 'a1b2c3d4e5f6a1b2c3d4e5f6' });
  const resolved: ChangesResolveResult = await doc.changes.resolve({ blockId: 'p1', limit: 20 });
  const lineage: string[] = resolved.lineage;
  const actors: ChangesActorsResult = await doc.changes.actors();
  const sessionId: string | undefined = actors.items[0]?.sessionId;
  const snapshot: ChangesSnapshotResult = await doc.changes.snapshot({ includeState: true });
  const stateVector: string = snapshot.stateVector;
  const state: string | undefined = snapshot.state;
  const lastChangeId: string | null = snapshot.lastChangeId;
  void [cursor, truncated, identity, collaboration, found, lineage, sessionId, stateVector, state, lastChangeId];
}
void readChanges;

// @ts-expect-error changes.get requires an id.
void doc.changes.get({});

// @ts-expect-error includeUpdate is a boolean.
void doc.changes.list({ includeUpdate: 'yes' });

// @ts-expect-error changes.resolve requires a blockId.
void doc.changes.resolve({ limit: 10 });

// @ts-expect-error a list result has no records field; read items.
void ((result: ChangesListResult) => result.records);
