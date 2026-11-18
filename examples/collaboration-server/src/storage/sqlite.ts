import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Doc, applyUpdate, encodeStateAsUpdate } from 'yjs';
import type { RoomStore, StoredRoom } from './types.ts';

export async function createSqliteRoomStore(filename: string): Promise<RoomStore & { close(): void }> {
  await mkdir(dirname(filename), { recursive: true });
  const database = new DatabaseSync(filename);
  database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=0;');
  database.exec('CREATE TABLE IF NOT EXISTS rooms (name TEXT PRIMARY KEY, generation TEXT NOT NULL, state BLOB)');
  const lookup = database.prepare('SELECT generation, state FROM rooms WHERE name = ?');
  const initialize = database.prepare('INSERT OR IGNORE INTO rooms (name, generation) VALUES (?, ?)');
  const replace = database.prepare('UPDATE rooms SET state = ? WHERE name = ? AND generation = ?');
  const reset = database.prepare('INSERT INTO rooms (name, generation) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET generation = excluded.generation, state = NULL');

  async function transaction<T>(operation: () => T): Promise<T> {
    const deadline = Date.now() + 5_000;
    while (true) {
      try {
        database.exec('BEGIN IMMEDIATE');
        break;
      } catch (error) {
        if (!(error instanceof Error) || !('errcode' in error) || error.errcode !== 5 || Date.now() >= deadline) throw error;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    try {
      const value = operation();
      database.exec('COMMIT');
      return value;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  function readRow(roomName: string): StoredRoom {
    const row = lookup.get(roomName);
    if (!row || typeof row.generation !== 'string' || (row.state !== null && !(row.state instanceof Uint8Array))) {
      throw new Error('Invalid stored collaboration room.');
    }
    return { generation: row.generation, initialGeneration: row.generation.startsWith('initial:'), state: row.state === null ? null : new Uint8Array(row.state) };
  }

  async function read(roomName: string): Promise<StoredRoom> {
    const row = lookup.get(roomName);
    if (!row) return { generation: '', initialGeneration: true, state: null };
    return readRow(roomName);
  }

  async function open(roomName: string): Promise<StoredRoom> {
    if (!lookup.get(roomName)) await transaction(() => initialize.run(roomName, `initial:${randomUUID()}`));
    return readRow(roomName);
  }

  async function commit(roomName: string, generation: string, state: Uint8Array): Promise<StoredRoom> {
    return transaction(() => {
      const current = readRow(roomName);
      if (current.generation !== generation) throw new Error('Room was reset.');
      const document = new Doc();
      try {
        if (current.state) applyUpdate(document, current.state);
        applyUpdate(document, state);
        const merged = encodeStateAsUpdate(document);
        replace.run(merged, roomName, generation);
        return { generation, initialGeneration: current.initialGeneration, state: merged };
      } finally {
        document.destroy();
      }
    });
  }

  return {
    coordination: { read, open, commit },
    async load(roomName) { return (await read(roomName)).state; },
    async store() { throw new Error('SQLite room writes require generation-fenced coordination.commit.'); },
    async delete(roomName) { await transaction(() => reset.run(roomName, randomUUID())); },
    close() { database.close(); },
  };
}
