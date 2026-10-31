import { describe, it, expect } from 'vite-plus/test';
import { createV2AwarenessDiffer, V2AwarenessIdRegistry } from './v2-awareness-bridge.ts';

const localUser = { id: 'local-1', name: 'Local', email: 'local@example.com', color: '#123456' };

describe('V2AwarenessIdRegistry', () => {
  it('assigns stable, monotonically increasing ids starting at 1', () => {
    const registry = new V2AwarenessIdRegistry();
    expect(registry.idFor('a')).toBe(1);
    expect(registry.idFor('b')).toBe(2);
    expect(registry.idFor('a')).toBe(1);
    expect(registry.has('a')).toBe(true);
    expect(registry.has('c')).toBe(false);
  });
});

describe('createV2AwarenessDiffer', () => {
  it('always includes the local user as client id 0', () => {
    const differ = createV2AwarenessDiffer(() => localUser);
    const payload = differ.next({ remoteActors: [] });
    expect(payload.states).toHaveLength(1);
    expect(payload.states[0]).toMatchObject({ clientId: 0, id: 'local-1', email: 'local@example.com' });
    expect(payload.added).toEqual([]);
    expect(payload.removed).toEqual([]);
  });

  it('maps remote actors to stable numeric client ids', () => {
    const differ = createV2AwarenessDiffer(() => localUser);
    const payload = differ.next({
      remoteActors: [{ actorLabel: 'Remote A', displayName: 'Remote A', email: 'a@example.com', color: '#ff0000' }],
    });
    expect(payload.states).toHaveLength(2);
    expect(payload.states[1]).toMatchObject({
      clientId: 1,
      name: 'Remote A',
      email: 'a@example.com',
      color: '#ff0000',
    });
    expect(payload.added).toEqual([1]);
  });

  it('computes added and removed across snapshots and keeps ids stable', () => {
    const differ = createV2AwarenessDiffer(() => localUser);
    differ.next({ remoteActors: [{ actorLabel: 'A', email: 'a@example.com' }] });

    const join = differ.next({
      remoteActors: [
        { actorLabel: 'A', email: 'a@example.com' },
        { actorLabel: 'B', email: 'b@example.com' },
      ],
    });
    expect(join.added).toEqual([2]);
    expect(join.removed).toEqual([]);

    const leave = differ.next({ remoteActors: [{ actorLabel: 'B', email: 'b@example.com' }] });
    expect(leave.removed).toEqual([1]);
    expect(leave.added).toEqual([]);
    expect(leave.states.find((s) => s.email === 'b@example.com')?.clientId).toBe(2);
  });

  it('deduplicates remote actors that resolve to the same identity key', () => {
    const differ = createV2AwarenessDiffer(() => localUser);
    const payload = differ.next({
      remoteActors: [
        { actorLabel: 'A', email: 'dupe@example.com' },
        { actorLabel: 'A (second tab)', email: 'dupe@example.com' },
      ],
    });
    expect(payload.states).toHaveLength(2);
  });

  it('falls back to actorLabel when email is absent', () => {
    const differ = createV2AwarenessDiffer(() => null);
    const payload = differ.next({ remoteActors: [{ actorLabel: 'anon-1' }] });
    expect(payload.states[1]).toMatchObject({ clientId: 1 });
  });
});
