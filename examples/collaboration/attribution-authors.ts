import { Item, decodeUpdate, type Doc } from 'yjs';

export type ClientDeclaration = {
  actorId: string | null;
  name?: string;
  email?: string;
  claim?: string;
  sessionId: string;
  declaredAt: string;
};

export type EditStamp = {
  at: string;
  actorType: 'human' | 'code';
  cause: 'user' | 'api' | 'undo' | 'redo' | 'maintenance';
  changeTag?: string;
  fromClock?: number;
  toClock?: number;
};

export type UpdateAuthor = {
  clientId: number;
  insertedStructs: number;
  declaration: ClientDeclaration | null;
  stamp: EditStamp | null;
};

export type UpdateAttribution = { maintenance: boolean; authors: UpdateAuthor[] };

type ClockRange = { start: number; end: number };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const optionalString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const optionalClock = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const isCause = (value: unknown): value is EditStamp['cause'] =>
  value === 'user' || value === 'api' || value === 'undo' || value === 'redo' || value === 'maintenance';

function readDeclaration(value: unknown): ClientDeclaration | null {
  if (!isRecord(value) || value.v !== 1) return null;
  const { actorId, sessionId, declaredAt } = value;
  if ((actorId !== null && typeof actorId !== 'string') || typeof sessionId !== 'string') return null;
  if (typeof declaredAt !== 'string') return null;
  return {
    actorId,
    sessionId,
    declaredAt,
    name: optionalString(value.name),
    email: optionalString(value.email),
    claim: optionalString(value.claim),
  };
}

function readStamp(value: unknown): EditStamp | null {
  if (!isRecord(value) || value.v !== 1 || typeof value.at !== 'string') return null;
  const { actorType, cause } = value;
  if ((actorType !== 'human' && actorType !== 'code') || !isCause(cause)) return null;
  return {
    at: value.at,
    actorType,
    cause,
    changeTag: optionalString(value.changeTag),
    fromClock: optionalClock(value.fromClock),
    toClock: optionalClock(value.toClock),
  };
}

function insideMaintenance(stamp: EditStamp | null, ranges: ClockRange[]): boolean {
  if (stamp?.cause !== 'maintenance' || stamp.fromClock === undefined || stamp.toClock === undefined) return false;
  const { fromClock, toClock } = stamp;
  return ranges.every(({ start, end }) => start >= fromClock && end <= toClock + 1);
}

export function attributeUpdate(room: Doc, update: Uint8Array): UpdateAttribution {
  const meta = room.getMap<unknown>('meta');
  const inserted = new Map<number, ClockRange[]>();
  for (const struct of decodeUpdate(update).structs) {
    if (!(struct instanceof Item)) continue;
    const ranges = inserted.get(struct.id.client) ?? [];
    ranges.push({ start: struct.id.clock, end: struct.id.clock + struct.length });
    inserted.set(struct.id.client, ranges);
  }

  const authors = [...inserted]
    .map(([clientId, ranges]) => ({
      clientId,
      insertedStructs: ranges.reduce((total, { start, end }) => total + end - start, 0),
      declaration: readDeclaration(meta.get(`attribution:client:${clientId}`)),
      stamp: readStamp(meta.get(`attribution:stamp:${clientId}`)),
    }))
    .sort((a, b) => b.insertedStructs - a.insertedStructs || a.clientId - b.clientId);

  const [only] = authors;
  const maintenance = authors.length === 1 && insideMaintenance(only.stamp, inserted.get(only.clientId) ?? []);
  return { maintenance, authors };
}
