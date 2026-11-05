import { describe, expect, it, vi } from 'vite-plus/test';
import type { ChangeRecord } from '@superdoc/document-api';
import { createSuperDocUI } from '../ui.js';
import type { SuperDocDocumentChange } from '../ui.js';
import { remoteChangeRecordsOf, remoteDocumentChange, storiesOfChangeRecords } from './document-change-records.js';

const body = { kind: 'story', storyType: 'body' } as const;
const footnote = { kind: 'story', storyType: 'footnote', noteId: '2' } as const;

function record(overrides: Partial<ChangeRecord> = {}): ChangeRecord {
  return {
    id: 'a1b2c3d4e5f6a1b2c3d4e5f6',
    seq: 1,
    revision: '7',
    origin: 'remote',
    actor: { id: 'user-ada', name: 'Ada' },
    actorType: 'human',
    cause: 'user',
    provenance: 'declared',
    at: { declared: '2026-11-04T10:00:00.000Z', observed: '2026-11-04T10:00:00.050Z' },
    session: { id: 'session-ada', clientId: 41 },
    changes: [
      { kind: 'text', story: body, blockId: 'P1', range: { start: 0, end: 5 }, inserted: 'Hello', deleted: '' },
    ],
    ...overrides,
  };
}

function mountController() {
  const hostListeners: Array<(event: Record<string, unknown>) => void> = [];
  const instanceListeners = new Map<string, (payload?: unknown) => void>();
  const host = {
    events: {
      subscribe: (listener: (event: Record<string, unknown>) => void) => {
        hostListeners.push(listener);
        return () => undefined;
      },
    },
  };
  const superdoc = {
    activeEditor: {
      doc: {
        comments: { list: () => ({ items: [] }) },
        trackChanges: { list: () => ({ items: [] }) },
        selection: { current: () => null },
      },
      host,
    },
    config: { documentMode: 'editing' },
    on: vi.fn((event: string, listener: (payload?: unknown) => void) => {
      instanceListeners.set(event, listener);
    }),
    off: vi.fn(),
  };
  const ui = createSuperDocUI({ superdoc: superdoc as never });
  const changes: SuperDocDocumentChange[] = [];
  ui.document.onChange((change) => changes.push(change));
  const emit = (event: Record<string, unknown>) => hostListeners.at(-1)?.(event);
  const remoteChanged = () =>
    emit({
      type: 'collaboration:remote-changed',
      remoteGeneration: 1,
      changedStoryIds: ['body'],
      changedPartUris: [],
      reviewChanged: false,
    });
  return { ui, changes, emit, remoteChanged, superdoc, host, instanceListeners };
}

describe('remote change records helpers', () => {
  it('keeps only remote records from a changes:recorded event', () => {
    const remote = record();
    const local = record({ id: 'local', origin: 'local' });
    expect(remoteChangeRecordsOf({ type: 'changes:recorded', records: [local, remote, null, 'x'] })).toEqual([remote]);
    expect(remoteChangeRecordsOf({ type: 'mutation:committed', records: [remote] })).toEqual([]);
    expect(remoteChangeRecordsOf({ type: 'changes:recorded' })).toEqual([]);
  });

  it('derives the distinct stories touched by records and skips sidecar changes', () => {
    const records = [
      record(),
      record({
        id: 'second',
        changes: [
          { kind: 'create', story: footnote, blockId: 'F1', text: 'Note' },
          {
            kind: 'format',
            story: { ...body },
            blockId: 'P1',
            range: { start: 0, end: 2 },
            attributes: { bold: true },
          },
          { kind: 'sidecar', affects: 'comment', ids: ['c1'] },
        ],
      }),
    ];
    expect(storiesOfChangeRecords(records)).toEqual([body, footnote]);
  });

  it('reports a shared remote change tag only when every record carries the same one', () => {
    expect(remoteDocumentChange([record({ changeTag: 'import' }), record({ changeTag: 'import' })]).changeTag).toBe(
      'import',
    );
    expect(remoteDocumentChange([record({ changeTag: 'import' }), record()]).changeTag).toBeNull();
  });

  it('keeps unknown scope for sidecar-only records and for no records', () => {
    const sidecar = record({ changes: [{ kind: 'sidecar', affects: 'trackedChange', ids: ['t1'] }] });
    expect(remoteDocumentChange([sidecar])).toEqual({
      cause: 'remote',
      changeTag: null,
      txId: null,
      scope: { kind: 'unknown' },
      records: [sidecar],
    });
    expect(remoteDocumentChange([])).toEqual({
      cause: 'remote',
      changeTag: null,
      txId: null,
      scope: { kind: 'unknown' },
    });
  });
});

describe('document change records delivery', () => {
  it('attaches remote records to the remote change that follows them', () => {
    const { changes, emit, remoteChanged } = mountController();
    const first = record();
    const second = record({
      id: 'second',
      seq: 2,
      changes: [{ kind: 'create', story: footnote, blockId: 'F1', text: 'Note' }],
    });
    emit({ type: 'changes:recorded', records: [first, record({ id: 'mine', origin: 'local' })] });
    emit({ type: 'changes:recorded', records: [second] });
    remoteChanged();

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      seq: 1,
      cause: 'remote',
      changeTag: null,
      txId: null,
      scope: { kind: 'known', stories: [body, footnote] },
      records: [first, second],
    });
  });

  it('reports remote records that no remote change claims after the current task', async () => {
    const { changes, emit } = mountController();
    const sidecar = record({ changes: [{ kind: 'sidecar', affects: 'comment', ids: ['c1'] }] });
    emit({ type: 'changes:recorded', records: [sidecar] });
    expect(changes).toEqual([]);

    await Promise.resolve();

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ cause: 'remote', scope: { kind: 'unknown' }, records: [sidecar] });
  });

  it('does not report the same records twice when the remote change claims them', async () => {
    const { changes, emit, remoteChanged } = mountController();
    emit({ type: 'changes:recorded', records: [record()] });
    remoteChanged();
    await Promise.resolve();

    expect(changes).toHaveLength(1);
  });

  it('keeps the unknown remote change without records when the engine recorded none', () => {
    const { changes, emit, remoteChanged } = mountController();
    emit({ type: 'changes:recorded', records: [record({ origin: 'local' })] });
    remoteChanged();

    expect(changes).toHaveLength(1);
    expect(changes[0]).not.toHaveProperty('records');
    expect(changes[0]).toMatchObject({ cause: 'remote', scope: { kind: 'unknown' } });
  });

  it('drops pending records when the document is replaced', async () => {
    const { changes, emit } = mountController();
    emit({ type: 'changes:recorded', records: [record()] });
    emit({ type: 'collaboration:document-replaced', source: {}, previousSource: {} });
    await Promise.resolve();

    expect(changes).toEqual([]);
  });
});
